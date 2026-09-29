/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Rate-limit enforcement (Foundational Decisions §10.3, SRS Appendix C,
 * FR-WORD-05, NFR-SEC-11).
 *
 * The limits themselves are normative and live in Appendix C; this middleware
 * only applies one of them to a route. On breach it throws the shared
 * `AppError.rateLimit`, so the single error middleware of C2 surfaces the 429
 * and writes `Retry-After` from the error's metadata — no parallel response
 * formatting here.
 *
 * The counter store is INJECTED by the composition root rather than imported,
 * so the Redis-versus-in-memory selection of NFR-SEC-11 is a configuration
 * decision made once at boot instead of a branch at every call site.
 */

import { AppError } from '../errors/index.js';

/**
 * The Appendix C limits this iteration enforces. Reproduced as code from the
 * normative table; add an entry here when a new endpoint gains a limit.
 */
export const RATE_LIMITS = Object.freeze({
  /** `POST /request-word`: 10 per hour, keyed by the `pa_uid` UUID. */
  WORD_REQUEST: Object.freeze({ limit: 10, windowSeconds: 3600 }),
  /** Save/tag POSTs: 60 per minute, keyed by the `pa_uid` UUID (FR-SAVE-09 listens share it). */
  SAVE_TAG: Object.freeze({ limit: 60, windowSeconds: 60 }),
  /** `POST /login`: 5 per 15 minutes, keyed by UUID + IP (FR-AUTH-15). */
  LOGIN: Object.freeze({ limit: 5, windowSeconds: 900 }),
  /** `POST /register`: 3 per hour, keyed by IP (FR-AUTH-15). */
  REGISTER: Object.freeze({ limit: 3, windowSeconds: 3600 }),
  /** `POST /reset-password`: 3 per hour, keyed by email address (FR-AUTH-15). */
  PASSWORD_RESET: Object.freeze({ limit: 3, windowSeconds: 3600 }),
  /** `POST /verify-email/resend`: 3 per hour, keyed by account ID (FR-AUTH-10, FR-AUTH-15). */
  VERIFICATION_RESEND: Object.freeze({ limit: 3, windowSeconds: 3600 }),
});

/**
 * The default identity key: the anonymous UUID. `ensureAnonymousId` mints one
 * when the request carried no cookie, so a client that simply discards cookies
 * still gets a stable key for the life of the request and cannot sidestep the
 * limit by never presenting one.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export const byAnonymousId = (req) => req.ensureAnonymousId();

/** Appendix C `POST /register`. @param {import('express').Request} req */
export const byIp = (req) => `ip:${req.ip}`;

/** Appendix C `POST /login`. @param {import('express').Request} req */
export const byAnonymousIdAndIp = (req) => `${req.ensureAnonymousId()}:ip:${req.ip}`;

/**
 * Build a rate-limit middleware for one endpoint.
 *
 * @param {object} options
 * @param {{ consume: (key: string, limit: number, windowSeconds: number) => Promise<object> }}
 *   options.store the injected counter store
 * @param {string} options.bucket a stable name for this limit's key space
 * @param {number} options.limit
 * @param {number} options.windowSeconds
 * @param {(req: import('express').Request) => string | Promise<string>} [options.keyOf]
 *   the Appendix C identity key; the anonymous UUID unless the table says otherwise
 * @returns {import('express').RequestHandler}
 */
export function rateLimitMiddleware({ store, bucket, limit, windowSeconds, keyOf = byAnonymousId }) {
  return async function enforceRateLimit(req, res, next) {
    try {
      const identity = await keyOf(req);
      const decision = await store.consume(`${bucket}:${identity}`, limit, windowSeconds);

      if (!decision.allowed) {
        next(AppError.rateLimit(decision.retryAfterSeconds));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export default rateLimitMiddleware;
