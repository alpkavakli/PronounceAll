/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Email verification and password reset (FR-AUTH-09/10/11, NFR-SEC-10,
 * NFR-SEC-12; SDD v1.1 §4.3, §5.6, V3).
 *
 * Tokens: 256 bits from the CSPRNG; only their SHA-256 is stored; single use;
 * 24 hours for verification, 1 hour for reset; a new token of a type closes
 * every open one of that type. A token is looked up and consumed under a row
 * lock, so two uses of one link cannot both succeed. Malformed, unknown,
 * expired and used tokens all fail without changing anything.
 *
 * No enumeration: asking for a reset or a new verification link answers the
 * same way whether or not an account exists, and the email itself is sent
 * after the response is decided, so the time taken does not depend on it
 * either. Verification never signs anyone in.
 *
 * A reset changes the password and moves `users.session_epoch` in one
 * transaction (V3), so every session ends at once; the Redis records are then
 * removed as a best-effort cleanup, and a notice goes to the verified address.
 *
 * No raw token, link or message body is ever logged.
 */

import { createHash } from 'node:crypto';

import { AppError } from '../errors/index.js';
import { generateSecureToken } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import {
  findAccountEmail,
  findPasswordCredentialByEmail,
  markEmailVerified,
  replacePasswordAndEndSessions,
} from '../repositories/accounts.repository.js';
import {
  closeOpenTokens,
  consumeToken,
  findTokenByHash,
  insertAuthToken,
  lockTokenByHash,
} from '../repositories/auth-tokens.repository.js';
import { withTransaction } from '../repositories/transaction.js';

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

/** A raw token as issued: 32 bytes, base64url, 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

/**
 * A usable email address: one `@`, something either side, a dot in the domain,
 * no whitespace, at most 320 characters. Deliberately loose — the verification
 * email is the real check.
 *
 * @param {unknown} value
 * @returns {string|null} the trimmed address, or null when unusable
 */
export function normaliseEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length === 0 || email.length > 320) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * The Appendix C key for a limit "per email address": a hash, so no address is
 * written into Redis. Case-insensitive, like the address itself (FR-AUTH-06).
 *
 * @param {unknown} emailInput
 * @returns {string}
 */
export function rateKeyForEmail(emailInput) {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  return `email:${createHash('sha256').update(email).digest('hex')}`;
}

/**
 * The Appendix C key for `POST /verify-email/resend`, "per account ID": the
 * account behind the address when there is one; otherwise the address's own
 * hash, so an unknown address is limited just the same and the limit reveals
 * nothing about whether an account exists.
 *
 * @param {unknown} emailInput
 * @returns {Promise<string>}
 */
export async function rateKeyForVerificationResend(emailInput) {
  const email = normaliseEmail(emailInput);
  const credential = email ? await findPasswordCredentialByEmail(email) : null;
  return credential ? `account:${credential.userId}` : rateKeyForEmail(emailInput);
}

/**
 * @param {object} dependencies
 * @param {import('../lib/mailer.js').SendMail} dependencies.sendMail
 * @param {{ verification: (token: string) => string, reset: (token: string) => string }} dependencies.links
 * @param {{ hashPassword: (p: string) => Promise<string> }} dependencies.passwords
 * @param {{ requireAcceptablePassword: (p: unknown) => Promise<string> }} dependencies.passwordPolicy
 * @param {{ endAllSessions: (userId: number) => Promise<void> }} dependencies.sessionService
 * @param {(token: string, remoteIp?: string) => Promise<{ success: boolean }>} dependencies.verifyTurnstile
 *   FR-AUTH-14 gates `POST /reset-password`
 * @param {() => Date} [dependencies.clock]
 */
export function createAccountEmailService({
  sendMail,
  links,
  passwords,
  passwordPolicy,
  sessionService,
  verifyTurnstile,
  clock = () => new Date(),
}) {
  /** Send without holding the caller: the outcome of a request never depends on delivery. */
  function deliver(message, purpose) {
    sendMail(message).catch((error) => {
      logger.error({ reason: error?.name ?? 'Error', purpose }, 'Transactional email could not be sent');
    });
  }

  /**
   * Issue a verification token inside the caller's transaction, closing any
   * open one (FR-AUTH-10).
   *
   * @param {number} userId
   * @param {import('../repositories/transaction.js').Executor} tx
   * @param {Date} now
   * @returns {Promise<string>} the raw token, for the link only
   */
  async function issueVerificationToken(userId, tx, now) {
    const raw = generateSecureToken(32);
    await closeOpenTokens({ userId, tokenType: 'email_verification', now }, tx);
    await insertAuthToken(
      {
        userId,
        tokenType: 'email_verification',
        tokenHash: hashToken(raw),
        expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
        now,
      },
      tx,
    );
    return raw;
  }

  /** @param {string} email @param {string} raw */
  function sendVerificationEmail(email, raw) {
    deliver(
      {
        to: email,
        subject: 'Confirm your email for PronounceAll',
        text:
          'Confirm your email address to finish creating your PronounceAll account:\n\n' +
          `${links.verification(raw)}\n\n` +
          'The link works once and expires in 24 hours. If you did not create an account, ignore this email.\n',
      },
      'email_verification',
    );
  }

  /**
   * FR-AUTH-10. The same answer whether or not the address belongs to an
   * unverified account; only such an account gets a new link.
   *
   * @param {unknown} emailInput
   */
  async function resendVerification(emailInput) {
    const email = normaliseEmail(emailInput);
    if (!email) return;
    const credential = await findPasswordCredentialByEmail(email);
    if (!credential || credential.emailVerifiedAt || credential.deletionState !== 'none') return;

    const raw = await withTransaction((tx) => issueVerificationToken(credential.userId, tx, clock()));
    sendVerificationEmail(credential.email, raw);
  }

  /**
   * FR-AUTH-09. Never signs anyone in.
   *
   * @param {unknown} rawToken
   * @returns {Promise<'verified'|'already-verified'|'expired'|'invalid'>}
   */
  async function verifyEmail(rawToken) {
    if (typeof rawToken !== 'string' || !TOKEN_SHAPE.test(rawToken)) return 'invalid';
    return withTransaction(async (tx) => {
      const token = await lockTokenByHash(hashToken(rawToken), 'email_verification', tx);
      if (!token) return 'invalid';
      const now = clock();
      if (token.consumedAt) {
        // A used link for an account that is verified is not an error for the
        // person who clicked it (a mail scanner may have followed it first).
        const account = await findAccountEmail(token.userId, tx);
        return account?.emailVerifiedAt ? 'already-verified' : 'invalid';
      }
      if (now >= token.expiresAt) return 'expired';
      await consumeToken(token.tokenId, now, tx);
      await markEmailVerified(token.userId, now, tx);
      return 'verified';
    });
  }

  /**
   * FR-AUTH-11. The same answer for every address; only an account with a
   * verified email gets a link.
   *
   * @param {object} request
   * @param {unknown} request.email
   * @param {string|undefined} request.turnstileToken
   * @param {string} [request.remoteIp]
   */
  async function requestPasswordReset({ email: emailInput, turnstileToken, remoteIp }) {
    const verification = await verifyTurnstile(turnstileToken, remoteIp);
    if (!verification.success) {
      throw AppError.validation('Please complete the verification challenge and try again.');
    }
    const email = normaliseEmail(emailInput);
    if (!email) return;
    const credential = await findPasswordCredentialByEmail(email);
    if (!credential || !credential.emailVerifiedAt || credential.deletionState !== 'none') return;

    const raw = generateSecureToken(32);
    await withTransaction(async (tx) => {
      const now = clock();
      await closeOpenTokens({ userId: credential.userId, tokenType: 'password_reset', now }, tx);
      await insertAuthToken(
        {
          userId: credential.userId,
          tokenType: 'password_reset',
          tokenHash: hashToken(raw),
          expiresAt: new Date(now.getTime() + RESET_TTL_MS),
          now,
        },
        tx,
      );
    });
    deliver(
      {
        to: credential.email,
        subject: 'Reset your PronounceAll password',
        text:
          'Someone asked to reset the password for your PronounceAll account. To choose a new one:\n\n' +
          `${links.reset(raw)}\n\n` +
          'The link works once and expires in 1 hour. If this was not you, ignore this email; your password is unchanged.\n',
      },
      'password_reset',
    );
  }

  /**
   * Whether a reset link can still be used, to decide which page to show.
   * Changes nothing.
   *
   * @param {unknown} rawToken
   * @returns {Promise<'valid'|'expired'|'invalid'>}
   */
  async function inspectResetToken(rawToken) {
    if (typeof rawToken !== 'string' || !TOKEN_SHAPE.test(rawToken)) return 'invalid';
    const token = await findTokenByHash(hashToken(rawToken), 'password_reset');
    if (!token || token.consumedAt) return 'invalid';
    return clock() >= token.expiresAt ? 'expired' : 'valid';
  }

  /**
   * FR-AUTH-11: set a new password with a reset link.
   *
   * @param {object} request
   * @param {unknown} request.token
   * @param {unknown} request.password
   * @returns {Promise<void>}
   * @throws {AppError} 400 for an unusable link or password; 503 when the breach check cannot run
   */
  async function resetPassword({ token: rawToken, password }) {
    const unusable = () => AppError.validation('This reset link is no longer valid. Please request a new one.');
    if (typeof rawToken !== 'string' || !TOKEN_SHAPE.test(rawToken)) throw unusable();

    const accepted = await passwordPolicy.requireAcceptablePassword(password);
    const passwordHash = await passwords.hashPassword(accepted);

    const userId = await withTransaction(async (tx) => {
      const token = await lockTokenByHash(hashToken(rawToken), 'password_reset', tx);
      const now = clock();
      if (!token || token.consumedAt || now >= token.expiresAt) throw unusable();

      await consumeToken(token.tokenId, now, tx);
      // Any password change closes every outstanding reset link (FR-AUTH-11).
      await closeOpenTokens({ userId: token.userId, tokenType: 'password_reset', now }, tx);
      // New hash and session_epoch + 1 together: every session ends (V3).
      await replacePasswordAndEndSessions({ userId: token.userId, passwordHash, now }, tx);
      return token.userId;
    });

    try {
      await sessionService.endAllSessions(userId);
    } catch (error) {
      // The epoch already ended them; this only tidies Redis.
      logger.warn({ reason: error?.name ?? 'Error' }, 'Session cleanup after password reset incomplete');
    }

    const account = await findAccountEmail(userId);
    if (account?.email && account.emailVerifiedAt) {
      deliver(
        {
          to: account.email,
          subject: 'Your PronounceAll password was changed',
          text:
            'The password for your PronounceAll account was just changed, and every device was signed out.\n\n' +
            'If you did not do this, reset your password again at once from the sign-in page.\n',
        },
        'password_changed',
      );
    }
  }

  return {
    issueVerificationToken,
    sendVerificationEmail,
    resendVerification,
    verifyEmail,
    requestPasswordReset,
    inspectResetToken,
    resetPassword,
  };
}
