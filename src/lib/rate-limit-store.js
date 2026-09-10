/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Rate-limit counter stores (NFR-SEC-11, Foundational Decisions §10.3, V2).
 *
 * NFR-SEC-11 fixes the deployment shape: Redis in staging and production,
 * in-memory permitted for LOCAL DEVELOPMENT ONLY, selected by configuration
 * rather than by a code branch at the call site. Both stores implement the same
 * `consume` port, so the middleware never learns which one it holds.
 *
 * Both implement a genuine ROLLING window rather than a fixed one, because
 * FR-WORD-05's acceptance criterion is stated in those terms: "an 11th
 * submission within a rolling hour". A fixed window would let 20 submissions
 * through across a window boundary in a couple of minutes and still claim to
 * enforce 10 per hour.
 *
 * This is a shared infrastructure client per C4: consumed by middleware and the
 * composition root, never imported by a business service.
 */

import { generateCorrelationId } from './ids.js';
import { logger } from './logger.js';
import { getRedis } from './redis.js';

/**
 * @typedef {object} RateLimitDecision
 * @property {boolean} allowed
 * @property {number} remaining          requests left in the current window
 * @property {number} retryAfterSeconds  0 when allowed; the `Retry-After` value
 *   when denied (Foundational Decisions §10.3)
 */

/**
 * The rolling window as one atomic server-side step.
 *
 * Evaluated in Redis rather than as a read-then-write from Node, because two
 * concurrent submissions from the same UUID would otherwise both read a count
 * below the limit and both be admitted — the exact case a rate limit exists to
 * stop. The sorted set holds one member per admitted request scored by its
 * timestamp; expired members are trimmed on each call, so the window slides.
 */
const ROLLING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local used = redis.call('ZCARD', key)

if used >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window - (now - tonumber(oldest[2]))
  if retry < 1 then retry = 1 end
  return {0, 0, retry}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, limit - used - 1, 0}
`;

/**
 * Redis-backed store. The counters are ephemeral with a TTL: NFR-SEC-11 states
 * that loss of Redis data at most resets limits, which is why a Redis outage
 * below fails OPEN rather than locking every visitor out of a form.
 *
 * @param {import('ioredis').Redis} [redis]
 * @returns {{ consume: (key: string, limit: number, windowSeconds: number) => Promise<RateLimitDecision> }}
 */
export function createRedisRateLimitStore(redis = getRedis()) {
  return {
    async consume(key, limit, windowSeconds) {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      try {
        const [allowed, remaining, retryMs] = await redis.eval(
          ROLLING_WINDOW_SCRIPT,
          1,
          `ratelimit:${key}`,
          String(now),
          String(windowMs),
          String(limit),
          `${now}-${generateCorrelationId()}`,
        );
        return {
          allowed: allowed === 1,
          remaining: Number(remaining),
          retryAfterSeconds: Math.ceil(Number(retryMs) / 1000),
        };
      } catch (error) {
        // Fail open, loudly. NFR-SEC-11 already accepts that losing the counter
        // store resets limits, so a Redis outage must not take the form with
        // it; the edge WAF limit of Appendix C still applies underneath.
        logger.error({ err: error }, 'Rate-limit store unavailable; request admitted unchecked');
        return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
      }
    },
  };
}

/**
 * In-memory store. Permitted for LOCAL DEVELOPMENT ONLY (NFR-SEC-11): the
 * counters live in one process, so they neither survive a restart nor hold
 * across the several processes a real deployment runs. The configuration layer,
 * not this module, is what keeps it out of staging and production.
 *
 * @returns {{ consume: (key: string, limit: number, windowSeconds: number) => Promise<RateLimitDecision> }}
 */
export function createInMemoryRateLimitStore() {
  /** @type {Map<string, number[]>} key to admitted request timestamps */
  const windows = new Map();

  return {
    async consume(key, limit, windowSeconds) {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const cutoff = now - windowMs;

      const admitted = (windows.get(key) ?? []).filter((at) => at > cutoff);

      if (admitted.length >= limit) {
        windows.set(key, admitted);
        const retryMs = windowMs - (now - admitted[0]);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
        };
      }

      admitted.push(now);
      windows.set(key, admitted);

      // Bound the map: a single-process development store must not grow without
      // limit across a long-running `npm run dev`.
      if (windows.size > 10_000) {
        for (const [candidate, timestamps] of windows) {
          if (timestamps.every((at) => at <= cutoff)) {
            windows.delete(candidate);
          }
        }
      }

      return { allowed: true, remaining: limit - admitted.length, retryAfterSeconds: 0 };
    },
  };
}
