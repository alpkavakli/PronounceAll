/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The stateless CSRF token (FR-AUTH-20, SDD v1.1 §6.6). Pure: the secret is
 * passed in by the caller, which reads it from configuration.
 *
 * A token is HMAC-SHA256 under `CSRF_SECRET` over a purpose- and version-bound
 * input, so it is tied to one identity and cannot be confused with any other
 * HMAC the application might compute:
 *
 *   csrf:v1:anon:<pa_uid>
 *   csrf:v1:session:<pa_sid>   once signed in (Iteration 4)
 *
 * Nothing is stored and no cookie is set. Verification recomputes the token for
 * the request's own identity and compares in constant time. A session-bound
 * token rotates because the session does.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { generateSecureToken } from '../lib/ids.js';

const VERSION = 'v1';

/**
 * Who a token is bound to: the signed-in session, or else the anonymous
 * identity (SDD §6.6). A session-bound token rotates with the session, so login,
 * logout and a password change all invalidate earlier tokens.
 *
 * @typedef {{ sessionId: string } | { anonymousId: string|null }} CsrfSubject
 */

/** @param {CsrfSubject} subject @returns {string|null} the bound input, or null when there is no identity */
function bindingOf(subject) {
  if ('sessionId' in subject) return subject.sessionId ? `session:${subject.sessionId}` : null;
  return subject.anonymousId ? `anon:${subject.anonymousId}` : null;
}

/**
 * @param {string} secret
 * @param {CsrfSubject} subject
 * @returns {string} base64url token
 */
export function issueCsrfTokenFor(secret, subject) {
  return createHmac('sha256', secret).update(`csrf:${VERSION}:${bindingOf(subject)}`).digest('base64url');
}

/**
 * @param {string} secret
 * @param {CsrfSubject} subject the identity the request carries
 * @param {unknown} presented the token the client sent
 * @returns {boolean}
 */
export function verifyCsrfTokenFor(secret, subject, presented) {
  if (typeof presented !== 'string' || presented.length === 0 || bindingOf(subject) === null) return false;
  const expected = Buffer.from(issueCsrfTokenFor(secret, subject));
  const actual = Buffer.from(presented);
  // timingSafeEqual requires equal lengths; a length mismatch is itself a
  // failure and reveals nothing about the expected value.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * @param {string} secret
 * @param {string} anonymousId
 * @returns {string} base64url token bound to `csrf:v1:anon:<pa_uid>`
 */
export function issueCsrfToken(secret, anonymousId) {
  return issueCsrfTokenFor(secret, { anonymousId });
}

/**
 * @param {string} secret
 * @param {string} anonymousId the identity the request carries
 * @param {unknown} presented the token the client sent
 * @returns {boolean}
 */
export function verifyCsrfToken(secret, anonymousId, presented) {
  return verifyCsrfTokenFor(secret, { anonymousId }, presented);
}

/**
 * Is the request same-origin? `Origin` must equal this site's origin when
 * present; without it, the browser's `Sec-Fetch-Site` must say same-origin. A
 * request carrying neither is refused.
 *
 * @param {object} request
 * @param {string|undefined} request.origin the `Origin` header
 * @param {string|undefined} request.fetchSite the `Sec-Fetch-Site` header
 * @param {string[]} request.allowedOrigins this site's origins
 * @returns {boolean}
 */
export function isSameOrigin({ origin, fetchSite, allowedOrigins }) {
  if (origin !== undefined) return allowedOrigins.includes(origin);
  return fetchSite === 'same-origin';
}

/**
 * The two per-viewer values a no-JavaScript confirmation form carries: the
 * CSRF token and a CSPRNG idempotency key (FR-SAVE-07, NFR-SEC-12). They are
 * separate concepts and are generated separately.
 *
 * @param {string} secret
 * @param {CsrfSubject} subject
 * @returns {{ csrfToken: string, idempotencyKey: string }}
 */
export function issueConfirmationCredentials(secret, subject) {
  return { csrfToken: issueCsrfTokenFor(secret, subject), idempotencyKey: generateSecureToken(24) };
}
