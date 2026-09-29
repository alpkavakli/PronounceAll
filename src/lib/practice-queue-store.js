/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The live practice queue in Redis (FR-PRACTICE-06; SDD v1.1 §4.10, §5.4).
 *
 * One key per session, rewritten after every accepted turn with a 60-minute
 * expiry, so the key's life is the session's idle deadline. It is a cache of
 * decisions MySQL does not hold (the random reinsertion and deferral choices):
 * when it is gone, the session is ended and a new one is built from the
 * then-current due state, never reconstructed.
 */

import { getRedis } from './redis.js';

export const PRACTICE_IDLE_SECONDS = 60 * 60;

const keyOf = (sessionId) => `practice:queue:${sessionId}`;

/**
 * @param {import('ioredis').Redis} [redis]
 */
export function createPracticeQueueStore(redis = getRedis()) {
  return {
    /** @returns {Promise<import('../services/practice-queue.service.js').PracticeQueue | null>} */
    async load(sessionId) {
      const raw = await redis.get(keyOf(sessionId));
      return raw ? JSON.parse(raw) : null;
    },
    async save(sessionId, queue) {
      await redis.set(keyOf(sessionId), JSON.stringify(queue), 'EX', PRACTICE_IDLE_SECONDS);
    },
    async remove(sessionId) {
      await redis.del(keyOf(sessionId));
    },
  };
}
