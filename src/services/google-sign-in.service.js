/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Google sign-in and registration (FR-AUTH-04a, FR-AUTH-05, FR-AUTH-06,
 * FR-AUTH-14, FR-AUTH-16; SDD v1.1 §5.1, §5.6).
 *
 * Start: a fresh OAuth `state`, an OIDC `nonce` and a PKCE verifier, all from
 * the CSPRNG, are held server-side for ten minutes under the state's hash and
 * bound to the `pa_uid` of the browser that started. This state is its own
 * secret, never the application's CSRF token.
 *
 * Callback: the state is taken (read and deleted at once, so it works once),
 * must belong to this browser, and is checked before anything is exchanged. A
 * provider error, an unknown, expired, reused or foreign state, a failed
 * exchange or an ID token that does not validate all end the same safe way:
 * nothing is created, linked or merged.
 *
 * Identity: Google's `sub` is the durable key, never the email. A known `sub`
 * signs in. A new `sub` whose email any account already holds gets the generic
 * collision answer — no second account and no automatic linking (§5.6: linking
 * by email would be an account-takeover path, and is not a v1.0 feature). A new
 * `sub` with a free, Google-verified email is held as a pending registration
 * behind a single-use nonce while the person picks a username; the completion
 * arrives through `POST /register` like every other path (CSRF, Turnstile, the
 * rate limit), supplying only the nonce — never the `sub` or the email.
 *
 * Re-authentication (FR-SET-07): the same round trip, started from account
 * deletion with `max_age=0`, its state also bound to the account and the
 * session. It proves only that the signed-in person just signed in to Google
 * as this account (`auth_time` within five minutes); it never signs anyone in.
 * A soft-deleted account that signs in inside its window is restored (FR-SET-09).
 *
 * No code, token, secret, state or nonce is ever logged.
 */

import { createHash } from 'node:crypto';

import { AppError } from '../errors/index.js';
import { generateSecureToken } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import {
  DuplicateIdentityError,
  emailIsTaken,
  findGoogleAccount,
  insertGoogleAccount,
  insertUser,
} from '../repositories/accounts.repository.js';
import { withTransaction } from '../repositories/transaction.js';
import { restoreIfSoftDeleted } from './account-deletion.service.js';
import { requireAcceptableUsername } from './username-policy.service.js';

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
export const PENDING_REGISTRATION_TTL_SECONDS = 15 * 60;

const STATE_NAMESPACE = 'oauth-state:google';
const PENDING_NAMESPACE = 'pending-registration:google';

/** Every secret issued here: 32 bytes, base64url, 43 characters. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Tolerated clock difference for `iat`, in seconds. */
const CLOCK_SKEW_SECONDS = 300;

/** FR-SET-07: how recent Google's own sign-in must be to count as re-authentication. */
export const REAUTH_MAX_AGE_SECONDS = 300;

/**
 * Validate the claims of an ID token received directly from Google's token
 * endpoint (OIDC Core §3.1.3.7).
 *
 * @param {string} idToken a JWT
 * @param {object} expected
 * @param {string} expected.clientId the audience
 * @param {string} expected.nonce the nonce this flow issued
 * @param {number} expected.nowSeconds
 * @returns {{ ok: true, claims: { sub: string, email: string, picture: string|null, authTime: number|null } } | { ok: false, reason: string }}
 */
export function validateGoogleIdToken(idToken, { clientId, nonce, nowSeconds }) {
  if (typeof idToken !== 'string') return { ok: false, reason: 'malformed' };
  const parts = idToken.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };

  if (!GOOGLE_ISSUERS.has(claims.iss)) return { ok: false, reason: 'issuer' };
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(clientId)) return { ok: false, reason: 'audience' };
  if (audiences.length > 1 && claims.azp !== clientId) return { ok: false, reason: 'audience' };
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  if (typeof claims.iat !== 'number' || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'issued-at' };
  }
  if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) return { ok: false, reason: 'nonce' };
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) {
    return { ok: false, reason: 'subject' };
  }
  if (typeof claims.email !== 'string' || claims.email.length === 0 || claims.email.length > 320) {
    return { ok: false, reason: 'email' };
  }
  // A Google email that Google has not verified is never taken as verified.
  if (claims.email_verified !== true) return { ok: false, reason: 'email-unverified' };

  const picture = typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) && claims.picture.length <= 512
    ? claims.picture
    : null;
  const authTime = typeof claims.auth_time === 'number' ? claims.auth_time : null;
  return { ok: true, claims: { sub: claims.sub, email: claims.email, picture, authTime } };
}

/** PKCE S256 (RFC 7636). */
const codeChallengeFor = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/** A re-auth flow names its session by hash: the raw `pa_sid` is a bearer secret. */
const sessionBinding = (sessionId) => createHash('sha256').update(String(sessionId)).digest('base64url');

/**
 * @param {object} dependencies
 * @param {import('../lib/google-oidc.js').GoogleOidcClient} dependencies.google
 * @param {ReturnType<import('../lib/flow-secret-store.js').createFlowSecretStore>} dependencies.secrets
 * @param {(token: string, remoteIp?: string) => Promise<{ success: boolean }>} dependencies.verifyTurnstile
 * @param {() => Date} [dependencies.clock]
 */
export function createGoogleSignInService({ google, secrets, verifyTurnstile, clock = () => new Date() }) {
  /**
   * @param {object} request
   * @param {string} request.anonymousId the `pa_uid` of the browser starting
   * @returns {Promise<string>} the Google authorization URL
   */
  async function begin({ anonymousId }) {
    const state = generateSecureToken(32);
    const nonce = generateSecureToken(32);
    const codeVerifier = generateSecureToken(32);
    await secrets.put(STATE_NAMESPACE, state, { anonymousId, nonce, codeVerifier }, OAUTH_STATE_TTL_SECONDS);
    return google.authorizationUrl({ state, nonce, codeChallenge: codeChallengeFor(codeVerifier) });
  }

  /**
   * FR-SET-07 step 1 for a Google account: a fresh Google round trip. The
   * flow is bound to this browser, this account and this session, and Google
   * is asked to authenticate the person again (`max_age=0`).
   *
   * @param {{ anonymousId: string, userId: number, sessionId: string }} request
   * @returns {Promise<string>} the Google authorization URL
   */
  async function beginReauth({ anonymousId, userId, sessionId }) {
    const state = generateSecureToken(32);
    const nonce = generateSecureToken(32);
    const codeVerifier = generateSecureToken(32);
    await secrets.put(
      STATE_NAMESPACE,
      state,
      { anonymousId, nonce, codeVerifier, purpose: 'reauth', userId, session: sessionBinding(sessionId) },
      OAUTH_STATE_TTL_SECONDS,
    );
    return google.authorizationUrl({ state, nonce, codeChallenge: codeChallengeFor(codeVerifier), fresh: true });
  }

  /** A failed outcome; the reason is for the log, never the page. */
  const failed = (reason) => {
    logger.warn({ reason }, 'Google sign-in refused');
    return { kind: 'failed', reason };
  };

  /**
   * @param {object} callback
   * @param {unknown} callback.state
   * @param {unknown} callback.code
   * @param {unknown} callback.error set by Google when the person refused or the request failed
   * @param {string|null} callback.anonymousId the `pa_uid` of the browser arriving
   * @param {{ userId: number, sessionId: string } | null} [callback.session] the session arriving, for a re-auth
   * @returns {Promise<
   *   { kind: 'signed-in', userId: number, sessionEpoch: number, restored: boolean }
   *   | { kind: 'reauthenticated', userId: number }
   *   | { kind: 'needs-username', pendingNonce: string, email: string }
   *   | { kind: 'cancelled' }
   *   | { kind: 'failed', reason: string }
   * >}
   */
  async function complete({ state, code, error, anonymousId, session = null }) {
    // The state is checked, and spent, before anything else — even an error
    // answer from Google has to belong to a flow this browser started.
    if (typeof state !== 'string' || !SECRET_SHAPE.test(state)) return failed('state-missing');
    const flow = await secrets.take(STATE_NAMESPACE, state);
    if (!flow) return failed('state-unknown');
    if (!anonymousId || flow.anonymousId !== anonymousId) return failed('state-foreign');

    if (error !== undefined) {
      logger.info({ reason: 'provider-error' }, 'Google sign-in not completed');
      return { kind: 'cancelled' };
    }
    if (typeof code !== 'string' || code.length === 0 || code.length > 2048) return failed('code-missing');

    let idToken;
    try {
      ({ idToken } = await google.exchangeCode({ code, codeVerifier: flow.codeVerifier }));
    } catch (cause) {
      return failed(`exchange:${cause?.name ?? 'Error'}`);
    }

    const validation = validateGoogleIdToken(idToken, {
      clientId: google.clientId,
      nonce: flow.nonce,
      nowSeconds: Math.floor(clock().getTime() / 1000),
    });
    if (!validation.ok) return failed(`id-token:${validation.reason}`);
    const { sub, email, picture, authTime } = validation.claims;
    const existing = await findGoogleAccount(sub);

    if (flow.purpose === 'reauth') {
      // The same account, the same session, and a Google sign-in made just now.
      const nowSeconds = Math.floor(clock().getTime() / 1000);
      if (!existing || existing.userId !== flow.userId) return failed('reauth-account');
      if (!session || session.userId !== flow.userId || sessionBinding(session.sessionId) !== flow.session) {
        return failed('reauth-session');
      }
      if (authTime === null || authTime < nowSeconds - REAUTH_MAX_AGE_SECONDS) return failed('reauth-stale');
      return { kind: 'reauthenticated', userId: existing.userId };
    }

    if (existing) {
      // FR-SET-09: inside the 30-day window, signing in restores the account.
      let restored = false;
      if (existing.deletionState === 'soft_deleted') {
        restored = await restoreIfSoftDeleted(existing.userId, clock);
        if (!restored) return failed('account-unavailable');
      } else if (existing.deletionState !== 'none') {
        return failed('account-unavailable');
      }
      return { kind: 'signed-in', userId: existing.userId, sessionEpoch: existing.sessionEpoch, restored };
    }

    // §5.6: never a second account for an email in use, and never linked by email.
    if (await emailIsTaken(email)) return failed('email-collision');

    const pendingNonce = generateSecureToken(32);
    await secrets.put(
      PENDING_NAMESPACE,
      pendingNonce,
      { googleSub: sub, email, picture, anonymousId },
      PENDING_REGISTRATION_TTL_SECONDS,
    );
    return { kind: 'needs-username', pendingNonce, email };
  }

  /**
   * The username step (FR-AUTH-04a, FR-AUTH-05), arriving through
   * `POST /register` after CSRF and the rate limit.
   *
   * @param {object} request
   * @param {unknown} request.pendingNonce
   * @param {unknown} request.username
   * @param {string|null} request.anonymousId
   * @param {string|undefined} request.turnstileToken
   * @param {string} [request.remoteIp]
   * @returns {Promise<{ userId: number, sessionEpoch: number }>}
   * @throws {AppError} 400 VALIDATION (the form can be retried with the same
   *   nonce), 409 CONFLICT for a taken username, or 400 with `meta.restart`
   *   when the pending registration is gone and the Google step must be redone
   */
  async function register({ pendingNonce, username, anonymousId, turnstileToken, remoteIp }) {
    const restart = () =>
      AppError.validation('This Google sign-up has expired or cannot be completed. Please start again.', {
        meta: { restart: true },
      });

    if (typeof pendingNonce !== 'string' || !SECRET_SHAPE.test(pendingNonce)) throw restart();
    const pending = await secrets.peek(PENDING_NAMESPACE, pendingNonce);
    if (!pending || !anonymousId || pending.anonymousId !== anonymousId) throw restart();

    const verification = await verifyTurnstile(turnstileToken, remoteIp);
    if (!verification.success) {
      throw AppError.validation('Please complete the verification challenge and try again.');
    }
    const acceptedUsername = requireAcceptableUsername(username);

    const now = clock();
    try {
      const userId = await withTransaction(async (tx) => {
        const id = await insertUser({ username: acceptedUsername, now }, tx);
        await insertGoogleAccount(
          { userId: id, googleSub: pending.googleSub, email: pending.email, pictureUrl: pending.picture, now },
          tx,
        );
        return id;
      });
      await secrets.remove(PENDING_NAMESPACE, pendingNonce);
      return { userId, sessionEpoch: 0 };
    } catch (error) {
      if (error instanceof DuplicateIdentityError && error.field === 'username') {
        throw AppError.conflict('That username is already taken.');
      }
      if (error instanceof DuplicateIdentityError) {
        // The Google identity or its email was registered meanwhile (a second
        // tab, a concurrent completion). Nothing was written here.
        await secrets.remove(PENDING_NAMESPACE, pendingNonce);
        throw restart();
      }
      throw error;
    }
  }

  return { begin, beginReauth, complete, register };
}
