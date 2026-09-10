/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Cloudflare Turnstile verification (FR-WORD-05).
 *
 * FR-WORD-05 gates the word-request form behind Turnstile. This module is the
 * adapter that talks to Cloudflare's siteverify endpoint; the domain service
 * receives a `verifyToken` function and never learns which implementation it
 * holds, which keeps the C4 rule that domain logic does not depend on a
 * concrete infrastructure client.
 *
 * Two implementations, selected once at the composition root by whether the
 * secret is configured:
 *
 *   - The Cloudflare verifier, used whenever `TURNSTILE_SECRET_KEY` is set. The
 *     configuration layer REQUIRES that secret in staging and production, so a
 *     real deployment always has genuine verification.
 *   - The unconfigured verifier, for a local checkout with no Cloudflare
 *     account. It still enforces the half of FR-WORD-05 that needs no upstream
 *     — a submission carrying no token is rejected — and it never reports a
 *     token as VERIFIED, because that would be pretending to a security
 *     property the deployment does not have. It logs a warning at boot.
 */

import { logger } from './logger.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Upstream verification must not hold a request open indefinitely. */
const VERIFY_TIMEOUT_MS = 5000;

/**
 * @typedef {object} TurnstileResult
 * @property {boolean} success
 * @property {boolean} verified true only when Cloudflare actually verified the
 *   token; false when no verifier was configured
 */

/**
 * The real verifier. Posts the token to Cloudflare's siteverify endpoint.
 *
 * @param {string} secretKey
 * @returns {(token: string, remoteIp?: string) => Promise<TurnstileResult>}
 */
export function createTurnstileVerifier(secretKey) {
  return async function verifyToken(token, remoteIp) {
    if (typeof token !== 'string' || token.length === 0) {
      return { success: false, verified: true };
    }

    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }

    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      const result = await response.json();
      if (!result.success) {
        // The error codes describe the TOKEN, not the visitor, so they are safe
        // to log; the token itself is never logged.
        logger.warn({ errorCodes: result['error-codes'] }, 'Turnstile token rejected');
      }
      return { success: Boolean(result.success), verified: true };
    } catch (error) {
      // Fail CLOSED. Unlike the rate limiter, this is an abuse gate the
      // specification requires on this endpoint, and admitting unverified
      // submissions during a Cloudflare outage would defeat it.
      logger.error({ err: error }, 'Turnstile verification failed to complete');
      return { success: false, verified: true };
    }
  };
}

/**
 * The unconfigured verifier, for local development without Cloudflare
 * credentials. Rejects a missing token — so the FR-WORD-05 rejection path is
 * exercised locally and in tests — and admits a present one WITHOUT claiming it
 * was verified.
 *
 * @returns {(token: string) => Promise<TurnstileResult>}
 */
export function createUnconfiguredTurnstileVerifier() {
  logger.warn(
    'TURNSTILE_SECRET_KEY is not configured: word-request submissions are not verified. ' +
      'This is permitted in development only; the configuration layer requires the secret ' +
      'in staging and production.',
  );
  return async function verifyTokenPresenceOnly(token) {
    return { success: typeof token === 'string' && token.length > 0, verified: false };
  };
}
