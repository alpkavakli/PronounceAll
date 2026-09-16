/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Idempotency reservations for state-changing writes (FR-SAVE-08, SDD v1.1
 * §5.2, NFR-SEC-11).
 *
 * The §5.2 lifecycle: a `PENDING` reservation is placed before the write, so a
 * concurrent duplicate cannot write too; it is promoted to `COMPLETED` with the
 * result after commit, so a later duplicate within the window replays that
 * result; and it is released on failure, so a genuine retry is not suppressed.
 * The window is FR-SAVE-08's 30 seconds.
 *
 * Both stores implement the same port and are selected once at boot, like the
 * rate-limit stores. A Redis outage fails OPEN, loudly: the save state machine
 * already makes a repeated action a no-op, so an unreserved duplicate writes
 * nothing new, and refusing every save during an outage would be worse.
 *
 * This is a shared infrastructure client per C4, injected into the service by
 * the composition root.
 */

import { logger } from './logger.js';
import { getRedis } from './redis.js';

export const IDEMPOTENCY_WINDOW_SECONDS = 30;

/**
 * @typedef {object} Reservation
 * @property {'reserved'|'pending'|'completed'} status
 *   `reserved` — this request owns the key and must complete or release it;
 *   `pending` — a duplicate is in flight; `completed` — replay `result`
 * @property {object} [result]
 */

/**
 * @typedef {object} IdempotencyStore
 * @property {(key: string) => Promise<Reservation>} reserve
 * @property {(key: string, result: object) => Promise<void>} complete
 * @property {(key: string) => Promise<void>} release
 */

/**
 * @param {import('ioredis').Redis} [redis]
 * @returns {IdempotencyStore}
 */
export function createRedisIdempotencyStore(redis = getRedis()) {
  const redisKey = (key) => `idem:${key}`;

  return {
    async reserve(key) {
      try {
        const won = await redis.set(redisKey(key), 'PENDING', 'EX', IDEMPOTENCY_WINDOW_SECONDS, 'NX');
        if (won === 'OK') return { status: 'reserved' };
        const held = await redis.get(redisKey(key));
        if (held && held !== 'PENDING') return { status: 'completed', result: JSON.parse(held) };
        return { status: 'pending' };
      } catch (error) {
        logger.error({ err: error }, 'Idempotency store unavailable; write proceeds unreserved');
        return { status: 'reserved' };
      }
    },

    async complete(key, result) {
      try {
        // KEEPTTL: a completed reservation lasts only the rest of the window.
        await redis.set(redisKey(key), JSON.stringify(result), 'KEEPTTL');
      } catch (error) {
        logger.error({ err: error }, 'Idempotency store unavailable; result not recorded');
      }
    },

    async release(key) {
      try {
        await redis.del(redisKey(key));
      } catch (error) {
        logger.error({ err: error }, 'Idempotency store unavailable; reservation not released');
      }
    },
  };
}

/**
 * In-memory store. LOCAL DEVELOPMENT AND TESTS ONLY (NFR-SEC-11): it holds in
 * one process and does not survive a restart.
 *
 * @param {{ now?: () => number }} [options]
 * @returns {IdempotencyStore}
 */
export function createInMemoryIdempotencyStore({ now = Date.now } = {}) {
  /** @type {Map<string, { value: 'PENDING' | object, expiresAt: number }>} */
  const entries = new Map();

  const live = (key) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    async reserve(key) {
      const entry = live(key);
      if (!entry) {
        entries.set(key, { value: 'PENDING', expiresAt: now() + IDEMPOTENCY_WINDOW_SECONDS * 1000 });
        return { status: 'reserved' };
      }
      return entry.value === 'PENDING' ? { status: 'pending' } : { status: 'completed', result: entry.value };
    },

    async complete(key, result) {
      const entry = live(key);
      if (entry) entry.value = result;
    },

    async release(key) {
      entries.delete(key);
    },
  };
}
