/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Changing a password and changing an email from Settings (FR-SET-02,
 * FR-AUTH-06/07/08/11/12; SDD v1.1 §4.3, V3).
 *
 * Change password: the current password must be right (one generic refusal
 * otherwise), the new one meets the FR-AUTH-07 policy, and the new hash commits
 * with `session_epoch + 1` in one transaction (V3) — every session on every
 * device ends — and every open reset link is closed (FR-AUTH-11). This device
 * then gets a new session: the rotation FR-AUTH-12 asks for on password change.
 *
 * Change email: the current password must be right as well (a stolen session
 * alone must not be able to redirect the account's email), and the address
 * must be usable and in no one's use (FR-AUTH-06, one generic refusal). It is
 * held as pending while a 24-hour confirmation link goes to it; the current
 * email stays active until that link is followed (FR-SET-02). A new request
 * replaces an older pending one. Confirming never signs anyone in.
 *
 * Accounts that sign in with Google have neither: their password and their
 * email are Google's.
 */

import { createHash } from 'node:crypto';

import { AppError } from '../errors/index.js';
import { generateSecureToken } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import {
  clearPendingEmail,
  confirmPendingEmail,
  DuplicateIdentityError,
  emailIsTaken,
  findPasswordCredentialByUserId,
  replacePasswordAndEndSessions,
  setPendingEmail,
} from '../repositories/accounts.repository.js';
import { closeOpenTokens, consumeToken, insertAuthToken, lockTokenByHash } from '../repositories/auth-tokens.repository.js';
import { withTransaction } from '../repositories/transaction.js';
import { normaliseEmail, VERIFICATION_TTL_MS } from './account-email.service.js';
import { PASSWORD_MAX_LENGTH } from './password-policy.service.js';

export const WRONG_CURRENT_PASSWORD_MESSAGE = 'That is not your current password.';
export const EMAIL_UNUSABLE_MESSAGE = 'This email cannot be used.';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

/**
 * @param {object} dependencies
 * @param {{ hashPassword: Function, verifyPassword: Function }} dependencies.passwords
 * @param {{ requireAcceptablePassword: (p: unknown) => Promise<string> }} dependencies.passwordPolicy
 * @param {ReturnType<import('./session.service.js').createSessionService>} dependencies.sessionService
 * @param {import('../lib/mailer.js').SendMail} dependencies.sendMail
 * @param {(token: string) => string} dependencies.emailChangeLink
 * @param {() => Date} [dependencies.clock]
 */
export function createAccountSettingsService({ passwords, passwordPolicy, sessionService, sendMail, emailChangeLink, clock = () => new Date() }) {
  /** The signed-in password account, with the current password checked. */
  async function requireCurrentPassword(userId, currentPassword) {
    const credential = await findPasswordCredentialByUserId(userId);
    if (!credential) throw AppError.forbidden('This account signs in with Google; its password and email are managed there.');
    const given = typeof currentPassword === 'string' ? currentPassword.slice(0, PASSWORD_MAX_LENGTH) : '';
    if (!(await passwords.verifyPassword(given, credential.passwordHash))) {
      throw AppError.validation(WRONG_CURRENT_PASSWORD_MESSAGE);
    }
    return credential;
  }

  /**
   * @param {{ userId: number, currentPassword: unknown, newPassword: unknown }} request
   * @returns {Promise<{ sessionId: string }>} this device's new session
   */
  async function changePassword({ userId, currentPassword, newPassword }) {
    await requireCurrentPassword(userId, currentPassword);
    const accepted = await passwordPolicy.requireAcceptablePassword(newPassword);
    const passwordHash = await passwords.hashPassword(accepted);

    const now = clock();
    await withTransaction(async (tx) => {
      await replacePasswordAndEndSessions({ userId, passwordHash, now }, tx);
      await closeOpenTokens({ userId, tokenType: 'password_reset', now }, tx);
    });
    try {
      await sessionService.endAllSessions(userId);
    } catch (error) {
      logger.warn({ reason: error?.name ?? 'Error' }, 'Session cleanup after password change incomplete');
    }
    const credential = await findPasswordCredentialByUserId(userId);
    return { sessionId: await sessionService.startSession(userId, credential.sessionEpoch) };
  }

  /**
   * @param {{ userId: number, currentPassword: unknown, newEmail: unknown }} request
   */
  async function requestEmailChange({ userId, currentPassword, newEmail }) {
    const credential = await requireCurrentPassword(userId, currentPassword);
    const email = normaliseEmail(newEmail);
    if (!email || email.toLowerCase() === credential.email?.toLowerCase() || (await emailIsTaken(email))) {
      throw AppError.validation(EMAIL_UNUSABLE_MESSAGE);
    }

    const raw = generateSecureToken(32);
    try {
      await withTransaction(async (tx) => {
        const now = clock();
        await setPendingEmail({ userId, email, now }, tx);
        await closeOpenTokens({ userId, tokenType: 'email_change', now }, tx);
        await insertAuthToken(
          { userId, tokenType: 'email_change', tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS), now },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof DuplicateIdentityError) throw AppError.validation(EMAIL_UNUSABLE_MESSAGE);
      throw error;
    }

    sendMail({
      to: email,
      subject: 'Confirm your new email for PronounceAll',
      text:
        'Someone asked to use this address for a PronounceAll account. To confirm it:\n\n' +
        `${emailChangeLink(raw)}\n\n` +
        'The link works once and expires in 24 hours. Until then the account keeps its current address. ' +
        'If this was not you, ignore this email.\n',
    }).catch((error) => logger.error({ reason: error?.name ?? 'Error', purpose: 'email_change' }, 'Transactional email could not be sent'));
  }

  /**
   * Follow the confirmation link. Never signs anyone in.
   *
   * @param {unknown} rawToken
   * @returns {Promise<'changed'|'expired'|'invalid'>}
   */
  async function confirmEmailChange(rawToken) {
    if (typeof rawToken !== 'string' || !TOKEN_SHAPE.test(rawToken)) return 'invalid';
    return withTransaction(async (tx) => {
      const token = await lockTokenByHash(hashToken(rawToken), 'email_change', tx);
      if (!token || token.consumedAt) return 'invalid';
      const now = clock();
      if (now >= token.expiresAt) return 'expired';
      await consumeToken(token.tokenId, now, tx);
      try {
        return (await confirmPendingEmail({ userId: token.userId, now }, tx)) ? 'changed' : 'invalid';
      } catch (error) {
        if (!(error instanceof DuplicateIdentityError)) throw error;
        // Another account took the address first; drop the pending change.
        await clearPendingEmail({ userId: token.userId, now }, tx);
        return 'invalid';
      }
    });
  }

  return { changePassword, requestEmailChange, confirmEmailChange };
}
