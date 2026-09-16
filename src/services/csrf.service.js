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
 *
 * Nothing is stored and no cookie is set. Verification recomputes the token for
 * the request's own identity and compares in constant time. When sessions
 * arrive (Iteration 4) the binding becomes `csrf:v1:session:<…>`, and the token
 * rotates because the session does.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { generateSecureToken } from '../lib/ids.js';

const VERSION = 'v1';

/**
 * @param {string} secret
 * @param {string} anonymousId
 * @returns {string} base64url token
 */
export function issueCsrfToken(secret, anonymousId) {
  return createHmac('sha256', secret).update(`csrf:${VERSION}:anon:${anonymousId}`).digest('base64url');
}

/**
 * @param {string} secret
 * @param {string} anonymousId the identity the request carries
 * @param {unknown} presented the token the client sent
 * @returns {boolean}
 */
export function verifyCsrfToken(secret, anonymousId, presented) {
  if (typeof presented !== 'string' || presented.length === 0 || !anonymousId) return false;
  const expected = Buffer.from(issueCsrfToken(secret, anonymousId));
  const actual = Buffer.from(presented);
  // timingSafeEqual requires equal lengths; a length mismatch is itself a
  // failure and reveals nothing about the expected value.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
 * @param {string} anonymousId
 * @returns {{ csrfToken: string, idempotencyKey: string }}
 */
export function issueConfirmationCredentials(secret, anonymousId) {
  return { csrfToken: issueCsrfToken(secret, anonymousId), idempotencyKey: generateSecureToken(24) };
}
