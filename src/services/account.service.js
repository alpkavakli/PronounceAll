/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Registration, login, and the merge that follows either (FR-AUTH-04/05/06/07/
 * 08/09/13/14/18/19, FR-CONSENT-04; SDD v1.1 §5.1, §5.6, V3).
 *
 * Registration (§5.6): Turnstile, then the username rules, the email or the
 * no-recovery acknowledgement, the password policy, then one transaction that
 * inserts the user and the credential — and either the no-recovery
 * acknowledgement (no email) or a verification token (email), whose email is
 * sent only after commit. Uniqueness is the database's; the checks only shape
 * the message. A duplicate username is reported plainly (usernames are
 * public); an unusable or already-used email gets one generic message, the same
 * for both, so registration is not an account-enumeration oracle (FR-AUTH-06).
 * An account with an email is not signed in until the email is verified
 * (FR-AUTH-09).
 *
 * Login, by username or by email: every failure is the one generic message
 * (FR-AUTH-13), and a bcrypt comparison always runs. Only once a correct
 * credential pair is presented may the answer say that the email is still
 * unverified — the explicit affordance FR-AUTH-13 allows.
 *
 * Merge (§5.1): after sign-in, the carried `pa_uid` is bound to the account if a
 * progress profile exists for it and it is not already bound, and the derived
 * state is recomputed across the account's identities in the same transaction —
 * latest event wins, by the same derivation reconciliation uses. The carried
 * identity is then retired so later signed-out activity on this browser does
 * not resolve back into the account.
 */

import { AppError } from '../errors/index.js';
import {
  DuplicateIdentityError,
  emailIsTaken,
  findPasswordCredentialByEmail,
  findPasswordCredentialByUsername,
  insertPasswordAccount,
  insertUser,
  insertUserConsent,
} from '../repositories/accounts.repository.js';
import { insertLinkBinding } from '../repositories/identity-bindings.repository.js';
import { anonymousProfileExists, findBoundUserId } from '../repositories/progress.repository.js';
import { withTransaction } from '../repositories/transaction.js';
import { normaliseEmail } from './account-email.service.js';
import { restoreIfSoftDeleted } from './account-deletion.service.js';
import { PASSWORD_MAX_LENGTH } from './password-policy.service.js';
import { recomputeAccountSm2States } from './practice.service.js';
import { recomputeOwnerStates } from './state-reconciliation.service.js';
import { requireAcceptableUsername } from './username-policy.service.js';

/**
 * Whether an anonymous identity has been bound to an account and so retired
 * (SDD §5.1). A retired identity is never used again for signed-out activity.
 *
 * @param {string} anonymousId
 * @returns {Promise<boolean>}
 */
export async function isRetiredAnonymousId(anonymousId) {
  return (await findBoundUserId(anonymousId)) !== null;
}

/** FR-AUTH-06: one message for an unusable and for an already-used email. */
export const EMAIL_REJECTED_MESSAGE = 'This email cannot be used for registration.';

/**
 * @param {object} dependencies
 * @param {(token: string, remoteIp?: string) => Promise<{ success: boolean }>} dependencies.verifyTurnstile
 * @param {{ requireAcceptablePassword: (p: unknown) => Promise<string> }} dependencies.passwordPolicy
 * @param {{ hashPassword: (p: string) => Promise<string>, verifyPassword: (p: string, h?: string|null) => Promise<boolean> }}
 *   dependencies.passwords bcrypt cost 12 (FR-AUTH-08); `verifyPassword` always
 *   runs one comparison, even with no hash (FR-AUTH-13)
 * @param {ReturnType<import('./session.service.js').createSessionService>} dependencies.sessionService
 * @param {ReturnType<import('./account-email.service.js').createAccountEmailService>} dependencies.accountEmailService
 * @param {() => Date} [dependencies.clock]
 */
export function createAccountService({
  verifyTurnstile,
  passwordPolicy,
  passwords,
  sessionService,
  accountEmailService,
  clock = () => new Date(),
}) {
  const { hashPassword, verifyPassword } = passwords;

  /** FR-AUTH-14: refused before anything else is looked at. */
  async function requireTurnstile(token, remoteIp) {
    const verification = await verifyTurnstile(token, remoteIp);
    if (!verification.success) {
      throw AppError.validation('Please complete the verification challenge and try again.');
    }
  }

  /**
   * Paths B and C of FR-AUTH-04: a username and password, with an email (which
   * must then be verified before sign-in) or without one (which needs the
   * no-recovery acknowledgement).
   *
   * @param {object} request
   * @param {unknown} request.username
   * @param {unknown} [request.email] empty or absent for no email
   * @param {unknown} request.password
   * @param {boolean} request.acknowledgedNoRecovery
   * @param {string|undefined} request.turnstileToken
   * @param {string} [request.remoteIp]
   * @returns {Promise<{ userId: number, sessionEpoch: number, verificationRequired: boolean }>}
   */
  async function register({ username, email: emailInput, password, acknowledgedNoRecovery, turnstileToken, remoteIp }) {
    await requireTurnstile(turnstileToken, remoteIp);
    const acceptedUsername = requireAcceptableUsername(username);

    const wantsEmail = typeof emailInput === 'string' && emailInput.trim().length > 0;
    const email = wantsEmail ? normaliseEmail(emailInput) : null;
    // FR-AUTH-06: in use means verified, pending verification, or held by a
    // pending email change; the answer is the same generic one in every case.
    if (wantsEmail && (!email || (await emailIsTaken(email)))) throw AppError.validation(EMAIL_REJECTED_MESSAGE);
    if (!email && !acknowledgedNoRecovery) {
      throw AppError.validation('Please confirm that you accept an account without email recovery.');
    }

    const accepted = await passwordPolicy.requireAcceptablePassword(password);
    const passwordHash = await hashPassword(accepted);
    const now = clock();
    try {
      const { userId, verificationToken } = await withTransaction(async (tx) => {
        const id = await insertUser({ username: acceptedUsername, now }, tx);
        await insertPasswordAccount({ userId: id, passwordHash, email, now }, tx);
        if (!email) {
          await insertUserConsent(
            { userId: id, consentType: 'no_recovery_ack', consentValue: 'acknowledged', now },
            tx,
          );
          return { userId: id, verificationToken: null };
        }
        return { userId: id, verificationToken: await accountEmailService.issueVerificationToken(id, tx, now) };
      });
      // After commit, never inside the transaction (§5.6).
      if (email) accountEmailService.sendVerificationEmail(email, verificationToken);
      return { userId, sessionEpoch: 0, verificationRequired: Boolean(email) };
    } catch (error) {
      if (error instanceof DuplicateIdentityError && error.field === 'username') {
        throw AppError.conflict('That username is already taken.');
      }
      if (error instanceof DuplicateIdentityError && error.field === 'email') {
        throw AppError.validation(EMAIL_REJECTED_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * @param {object} request
   * @param {unknown} request.identifier a username, or an email address
   * @param {unknown} request.password
   * @param {string|undefined} request.turnstileToken
   * @param {string} [request.remoteIp]
   * @returns {Promise<{ userId: number, sessionEpoch: number, verificationPending: false, restored: boolean } | { verificationPending: true, email: string }>}
   */
  async function login({ identifier, password, turnstileToken, remoteIp }) {
    await requireTurnstile(turnstileToken, remoteIp);
    const name = typeof identifier === 'string' ? identifier.trim() : '';
    const secret = typeof password === 'string' ? password : '';

    let credential = null;
    if (name.length > 0 && name.length <= 320) {
      credential = name.includes('@')
        ? await findPasswordCredentialByEmail(name)
        : await findPasswordCredentialByUsername(name);
    }
    // Always one bcrypt comparison (FR-AUTH-13).
    const matched = await verifyPassword(secret.slice(0, PASSWORD_MAX_LENGTH), credential?.passwordHash);
    if (!credential || !matched) throw AppError.auth();
    // FR-SET-09: inside the 30-day window a correct credential restores the
    // account; past it, or for a hard delete, the generic failure.
    let restored = false;
    if (credential.deletionState === 'soft_deleted') {
      restored = await restoreIfSoftDeleted(credential.userId, clock);
      if (!restored) throw AppError.auth();
    } else if (credential.deletionState !== 'none') {
      throw AppError.auth();
    }

    // FR-AUTH-09: blocked until verified — said only now, after a correct pair.
    if (credential.email && !credential.emailVerifiedAt) {
      return { verificationPending: true, email: credential.email };
    }
    return { userId: credential.userId, sessionEpoch: credential.sessionEpoch, verificationPending: false, restored };
  }

  /**
   * FR-AUTH-18/19, SDD §5.1.
   *
   * @param {number} userId
   * @param {string|null} anonymousId the carried `pa_uid`
   * @returns {Promise<{ linked: boolean, retireAnonymousId: boolean }>}
   */
  async function mergeAnonymousIdentity(userId, anonymousId) {
    // Cookie presence alone is not a mergeable profile.
    if (!anonymousId || !(await anonymousProfileExists(anonymousId))) {
      return { linked: false, retireAnonymousId: false };
    }

    let linked = false;
    if ((await findBoundUserId(anonymousId)) === null) {
      linked = await withTransaction(async (tx) => {
        const now = clock();
        // UNIQUE(anonymous_id): a concurrent login that linked first wins, and
        // this one writes nothing — never a second LINK, never a re-point (B1).
        const inserted = await insertLinkBinding({ anonymousId, userId, occurredAt: now }, tx);
        if (inserted) {
          // Both derivations, by the same latest-in-order rule (§5.1).
          await recomputeOwnerStates({ userId }, tx, now);
          await recomputeAccountSm2States(userId, tx);
        }
        return inserted;
      });
    }
    // Bound now, to this account or another: either way it is retired.
    return { linked, retireAnonymousId: true };
  }

  /**
   * Finish a successful registration or login: merge, then a fresh session.
   *
   * @param {{ userId: number, sessionEpoch: number }} authenticated
   * @param {string|null} anonymousId
   * @returns {Promise<{ sessionId: string, retireAnonymousId: boolean }>}
   */
  async function completeSignIn({ userId, sessionEpoch }, anonymousId) {
    const merge = await mergeAnonymousIdentity(userId, anonymousId);
    const sessionId = await sessionService.startSession(userId, sessionEpoch);
    return { sessionId, retireAnonymousId: merge.retireAnonymousId };
  }

  return { register, login, mergeAnonymousIdentity, completeSignIn };
}
