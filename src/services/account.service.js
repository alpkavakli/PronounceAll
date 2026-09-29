/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Registration, login, and the merge that follows either (FR-AUTH-04/05/07/08/
 * 13/14/18/19, FR-CONSENT-04; SDD v1.1 §5.1, §5.6, V3).
 *
 * Registration (§5.6): Turnstile, then the password and username rules, then
 * the breached-password check, then one transaction that inserts the user, the
 * credential and — for a username-only account — the no-recovery
 * acknowledgement. Uniqueness is the database's; the checks only shape the
 * message. A duplicate username is reported plainly (usernames are public).
 *
 * Login: every failure is the one generic message (FR-AUTH-13), and a bcrypt
 * comparison always runs, so an unknown username costs the same as a wrong
 * password.
 *
 * Merge (§5.1): after either, the carried `pa_uid` is bound to the account if a
 * progress profile exists for it and it is not already bound, and the derived
 * state is recomputed across the account's identities in the same transaction —
 * latest event wins, by the same derivation reconciliation uses. The carried
 * identity is then retired so later signed-out activity on this browser does
 * not resolve back into the account.
 */

import { AppError } from '../errors/index.js';
import { logger } from '../lib/logger.js';
import {
  DuplicateIdentityError,
  findPasswordCredentialByUsername,
  insertPasswordAccount,
  insertUser,
  insertUserConsent,
} from '../repositories/accounts.repository.js';
import { insertLinkBinding } from '../repositories/identity-bindings.repository.js';
import { anonymousProfileExists, findBoundUserId } from '../repositories/progress.repository.js';
import { withTransaction } from '../repositories/transaction.js';
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

/** FR-AUTH-07. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 100;

export const BREACHED_PASSWORD_MESSAGE =
  'This password has appeared in a known breach; please choose another.';

export const PASSWORD_CHECK_UNAVAILABLE_MESSAGE =
  "We couldn't verify this password right now. Please try again shortly.";

/**
 * @param {object} dependencies
 * @param {(token: string, remoteIp?: string) => Promise<{ success: boolean }>} dependencies.verifyTurnstile
 * @param {(password: string) => Promise<boolean>} dependencies.isBreachedPassword
 * @param {{ hashPassword: (p: string) => Promise<string>, verifyPassword: (p: string, h?: string|null) => Promise<boolean> }}
 *   dependencies.passwords bcrypt cost 12 (FR-AUTH-08); `verifyPassword` always
 *   runs one comparison, even with no hash (FR-AUTH-13)
 * @param {ReturnType<import('./session.service.js').createSessionService>} dependencies.sessionService
 * @param {() => Date} [dependencies.clock]
 */
export function createAccountService({
  verifyTurnstile,
  isBreachedPassword,
  passwords,
  sessionService,
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

  /** FR-AUTH-07: length only, no composition rules, then the breach check. */
  async function requireAcceptablePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
      throw AppError.validation(`Passwords are at least ${PASSWORD_MIN_LENGTH} characters long.`);
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      throw AppError.validation(`Passwords are at most ${PASSWORD_MAX_LENGTH} characters long.`);
    }
    let breached;
    try {
      breached = await isBreachedPassword(password);
    } catch (cause) {
      // Fail closed: an unchecked password is never accepted. The failure is
      // the service's, not the password's, and the message says so. Only the
      // error's kind is logged — never the password, its hash or the response.
      logger.warn({ reason: cause?.name ?? 'Error' }, 'Breached-password check unavailable; registration refused');
      throw AppError.unavailable(PASSWORD_CHECK_UNAVAILABLE_MESSAGE);
    }
    if (breached) throw AppError.validation(BREACHED_PASSWORD_MESSAGE);
  }

  /**
   * Path C without an email (FR-AUTH-04c, FR-CONSENT-04).
   *
   * @param {object} request
   * @param {unknown} request.username
   * @param {unknown} request.password
   * @param {boolean} request.acknowledgedNoRecovery
   * @param {string|undefined} request.turnstileToken
   * @param {string} [request.remoteIp]
   * @returns {Promise<{ userId: number, sessionEpoch: number }>}
   */
  async function registerWithUsername({ username, password, acknowledgedNoRecovery, turnstileToken, remoteIp }) {
    await requireTurnstile(turnstileToken, remoteIp);
    const acceptedUsername = requireAcceptableUsername(username);
    if (!acknowledgedNoRecovery) {
      throw AppError.validation('Please confirm that you accept an account without email recovery.');
    }
    await requireAcceptablePassword(password);

    const passwordHash = await hashPassword(/** @type {string} */ (password));
    const now = clock();
    try {
      const userId = await withTransaction(async (tx) => {
        const id = await insertUser({ username: acceptedUsername, now }, tx);
        await insertPasswordAccount({ userId: id, passwordHash, now }, tx);
        await insertUserConsent(
          { userId: id, consentType: 'no_recovery_ack', consentValue: 'acknowledged', now },
          tx,
        );
        return id;
      });
      return { userId, sessionEpoch: 0 };
    } catch (error) {
      if (error instanceof DuplicateIdentityError && error.field === 'username') {
        throw AppError.conflict('That username is already taken.');
      }
      throw error;
    }
  }

  /**
   * @param {object} request
   * @param {unknown} request.identifier the username
   * @param {unknown} request.password
   * @param {string|undefined} request.turnstileToken
   * @param {string} [request.remoteIp]
   * @returns {Promise<{ userId: number, sessionEpoch: number }>}
   */
  async function login({ identifier, password, turnstileToken, remoteIp }) {
    await requireTurnstile(turnstileToken, remoteIp);
    const name = typeof identifier === 'string' ? identifier.trim() : '';
    const secret = typeof password === 'string' ? password : '';

    const credential = name.length > 0 && name.length <= 320 ? await findPasswordCredentialByUsername(name) : null;
    // Always one bcrypt comparison (FR-AUTH-13).
    const matched = await verifyPassword(secret.slice(0, PASSWORD_MAX_LENGTH), credential?.passwordHash);
    if (!credential || !matched || credential.deletionState !== 'none') throw AppError.auth();

    return { userId: credential.userId, sessionEpoch: credential.sessionEpoch };
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
        if (inserted) await recomputeOwnerStates({ userId }, tx, now);
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

  return { registerWithUsername, login, mergeAnonymousIdentity, completeSignIn };
}
