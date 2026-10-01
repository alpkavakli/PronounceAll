/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Deleting an account (FR-SET-07/08/09; SDD v1.1 §4.9, §5.5, C6; Foundational
 * Decisions §8).
 *
 * Request: re-authentication first — the password, or a fresh Google round
 * trip — which yields a single-use nonce bound to this account and this
 * session, valid ten minutes. Only that nonce opens the choice. The chosen
 * option and `session_epoch + 1` commit in one transaction, so every session
 * ends with it (V3); the Redis records are cleared after commit, and exactly
 * one confirmation email goes to a verified address, if any. A soft delete
 * keeps everything for 30 days; a hard delete is due at once.
 *
 * Restoration (FR-SET-09): a correct sign-in inside the 30-day window clears
 * the deletion state and records `account_restored`, in one transaction.
 *
 * Purge (the hard-delete job, never a request): a due account is claimed by
 * compare-and-set, so one worker owns it; then, in that same transaction, the
 * ordered erasure of the account and every bound anonymous identity, the
 * word-request owners nulled, and a tombstone with no personal data. A crash
 * rolls the claim back, so a retry re-claims. The job sends no email: the one
 * confirmation went out at request time.
 */

import { createHash, randomUUID } from 'node:crypto';

import { AppError } from '../errors/index.js';
import { generateSecureToken } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import {
  findPasswordCredentialByUserId,
  findAccountSummary,
  requestAccountDeletion,
  restoreSoftDeletedAccount,
} from '../repositories/accounts.repository.js';
import { insertConsent } from '../repositories/consent.repository.js';
import {
  claimPurge,
  deleteAccountRows,
  insertDeletionTombstone,
  listBoundAnonymousIds,
  listDuePurges,
  listPracticeSessionIds,
  orphanWordRequests,
  purgeOwnerData,
} from '../repositories/erasure.repository.js';
import { withTransaction } from '../repositories/transaction.js';
import { PASSWORD_MAX_LENGTH } from './password-policy.service.js';

export const SOFT_DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export const REAUTH_TTL_SECONDS = 10 * 60;
const REAUTH_NAMESPACE = 'delete-reauth';
const NONCE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The proof names the session by hash: the raw `pa_sid` is a bearer secret. */
const sessionBinding = (sessionId) => createHash('sha256').update(String(sessionId)).digest('base64url');

/**
 * FR-SET-09: restore a soft-deleted account whose window is still open, and
 * record it. Called by every sign-in path after the credential is proven.
 *
 * @param {number} userId
 * @param {() => Date} [clock]
 * @returns {Promise<boolean>} whether the account was restored
 */
export async function restoreIfSoftDeleted(userId, clock = () => new Date()) {
  return withTransaction(async (tx) => {
    const now = clock();
    if (!(await restoreSoftDeletedAccount(userId, now, tx))) return false;
    await insertConsent({ owner: { userId }, consentType: 'account_restored', consentValue: 'acknowledged', now }, tx);
    return true;
  });
}

/**
 * @param {object} dependencies
 * @param {{ verifyPassword: Function }} dependencies.passwords
 * @param {ReturnType<import('./session.service.js').createSessionService>} dependencies.sessionService
 * @param {ReturnType<import('../lib/flow-secret-store.js').createFlowSecretStore>} dependencies.secrets
 * @param {{ remove: (sessionId: number) => Promise<void> }} dependencies.practiceQueueStore
 * @param {import('../lib/mailer.js').SendMail} dependencies.sendMail
 * @param {string} dependencies.contactEmail the "this wasn't me" address
 * @param {() => Date} [dependencies.clock]
 */
export function createAccountDeletionService({ passwords, sessionService, secrets, practiceQueueStore, sendMail, contactEmail, clock = () => new Date() }) {
  /**
   * The proof of a fresh re-authentication, for this account and session only.
   *
   * @param {{ userId: number, sessionId: string }} who
   * @returns {Promise<string>}
   */
  async function issueReauthNonce({ userId, sessionId }) {
    const nonce = generateSecureToken(32);
    await secrets.put(REAUTH_NAMESPACE, nonce, { userId, session: sessionBinding(sessionId) }, REAUTH_TTL_SECONDS);
    return nonce;
  }

  /**
   * FR-SET-07 step 1, password accounts.
   *
   * @param {{ userId: number, sessionId: string, password: unknown }} request
   * @returns {Promise<string>} the re-authentication nonce
   * @throws {AppError} 400 for a wrong password — the flow stops there
   */
  async function reauthenticateWithPassword({ userId, sessionId, password }) {
    const credential = await findPasswordCredentialByUserId(userId);
    if (!credential) throw AppError.forbidden('This account signs in with Google. Confirm with Google instead.');
    const given = typeof password === 'string' ? password.slice(0, PASSWORD_MAX_LENGTH) : '';
    if (!(await passwords.verifyPassword(given, credential.passwordHash))) {
      throw AppError.validation('That is not your current password.');
    }
    return issueReauthNonce({ userId, sessionId });
  }

  /**
   * FR-SET-07 step 2: execute the chosen option.
   *
   * @param {{ userId: number, sessionId: string, nonce: unknown, option: unknown }} request
   * @returns {Promise<{ option: 'soft'|'hard' }>}
   */
  async function requestDeletion({ userId, sessionId, nonce, option }) {
    const expired = () => AppError.validation('That confirmation has expired. Start again from Settings.');
    if (option !== 'soft' && option !== 'hard') throw AppError.validation('Choose how to delete the account.');
    if (typeof nonce !== 'string' || !NONCE_SHAPE.test(nonce)) throw expired();
    const proof = await secrets.take(REAUTH_NAMESPACE, nonce);
    if (!proof || proof.userId !== userId || proof.session !== sessionBinding(sessionId)) throw expired();

    const summary = await findAccountSummary(userId);
    const now = clock();
    const accepted = await withTransaction((tx) =>
      requestAccountDeletion(
        { userId, option, now, purgeAt: option === 'soft' ? new Date(now.getTime() + SOFT_DELETE_GRACE_MS) : now },
        tx,
      ),
    );
    if (!accepted) throw expired();

    // After commit: the epoch already ended every session; this tidies Redis.
    await sessionService.endAllSessions(userId).catch((error) =>
      logger.warn({ reason: error?.name ?? 'Error' }, 'Session cleanup after deletion request incomplete'),
    );

    // Exactly one confirmation, now, for either option (§5.5).
    if (summary?.email && summary.emailVerifiedAt) {
      const text =
        option === 'soft'
          ? 'Your PronounceAll account is deleted and will be erased for good in 30 days. ' +
            'Signing in before then restores it.\n\n' +
            `This wasn't me: if you did not ask for this, write to ${contactEmail} and sign in to restore the account.\n`
          : 'Your PronounceAll account is deleted. Everything it holds will be erased within 24 hours; ' +
            'this cannot be undone.\n\n' +
            `If you did not ask for this, write to ${contactEmail} at once.\n`;
      sendMail({ to: summary.email, subject: 'Your PronounceAll account was deleted', text }).catch((error) =>
        logger.error({ reason: error?.name ?? 'Error', purpose: 'deletion_confirmation' }, 'Transactional email could not be sent'),
      );
    }
    return { option };
  }

  /**
   * The hard-delete job (FR-SET-08): erase every account that is due. Safe to
   * run repeatedly and concurrently — the claim gives each account one owner.
   *
   * @returns {Promise<number>} how many accounts were erased by this run
   */
  async function purgeDueAccounts() {
    let erased = 0;
    for (const userId of await listDuePurges(clock())) {
      const outcome = await withTransaction(async (tx) => {
        const now = clock();
        if (!(await claimPurge(userId, now, tx))) return null;
        const anonymousIds = await listBoundAnonymousIds(userId, tx);
        const practiceSessionIds = await listPracticeSessionIds(userId, anonymousIds, tx);
        await purgeOwnerData({ userId }, tx);
        for (const anonymousId of anonymousIds) await purgeOwnerData({ anonymousId }, tx);
        await orphanWordRequests(userId, anonymousIds, tx);
        await deleteAccountRows(userId, anonymousIds, tx);
        await insertDeletionTombstone({ deletionId: randomUUID(), deletionType: 'hard_user', now: clock() }, tx);
        return { practiceSessionIds };
      });
      if (!outcome) continue;
      erased += 1;
      // After commit, best effort: Redis cannot join a MySQL rollback (§5.5).
      await sessionService.endAllSessions(userId).catch(() => {});
      for (const sessionId of outcome.practiceSessionIds) await practiceQueueStore.remove(sessionId).catch(() => {});
    }
    return erased;
  }

  return { reauthenticateWithPassword, issueReauthNonce, requestDeletion, purgeDueAccounts };
}
