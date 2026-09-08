/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Identifier generation (SDD v1.1 §7.6, NFR-SEC-12).
 *
 * Every security-sensitive value — session identifiers, CSRF tokens, reset and
 * verification tokens, server-side idempotency keys, deletion identifiers — is
 * generated from a cryptographically secure source with at least 128 bits of
 * entropy. `crypto.randomUUID` is NOT used for those, because a v4 UUID carries
 * only 122 random bits and falls below the floor. `Math.random` is prohibited
 * for any security-relevant value.
 */

import { randomBytes, randomUUID } from 'node:crypto';

/** Minimum entropy for a security-sensitive token, in bytes (NFR-SEC-12). */
const TOKEN_ENTROPY_BYTES = 32;

/**
 * Generate a security-sensitive token: 256 bits of CSPRNG entropy, base64url.
 *
 * @param {number} [bytes] entropy in bytes; never below the 16-byte floor
 * @returns {string} URL-safe token
 */
export function generateSecureToken(bytes = TOKEN_ENTROPY_BYTES) {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new RangeError('A security-sensitive token needs at least 16 bytes of entropy.');
  }
  return randomBytes(bytes).toString('base64url');
}

/**
 * Generate the anonymous profile identifier carried by the `pa_uid` cookie.
 *
 * This is the one documented exception to the 128-bit floor above: FR-AUTH-01
 * requires a valid UUID v4, and `pa_uid` is a pseudonymous identifier rather
 * than an authentication secret. `crypto.randomUUID` is itself CSPRNG-backed
 * (SDD v1.1 §7.6, NFR-SEC-12).
 *
 * @returns {string} a v4 UUID
 */
export function generateAnonymousId() {
  return randomUUID();
}

/** RFC 4122 v4 UUID, lower-case, as issued by {@link generateAnonymousId}. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} value candidate identifier, typically from a client cookie
 * @returns {boolean} true when `value` is a syntactically valid v4 UUID
 */
export function isValidAnonymousId(value) {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

/**
 * Generate the short correlation id that ties a safe error response to its log
 * line (SDD v1.1 §6.2). It is random and carries no data, so surfacing it to a
 * user exposes nothing while making a reported incident traceable.
 *
 * @returns {string} 16 hex characters
 */
export function generateCorrelationId() {
  return randomBytes(8).toString('hex');
}
