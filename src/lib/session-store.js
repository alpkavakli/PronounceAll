/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Registered sessions in Redis (FR-AUTH-12, V3; SDD v1.1 §4.10).
 *
 * A session record holds `userId`, the `sessionEpoch` it was created under, and
 * its `absoluteExpiresAt`. The key's expiry is the smaller of the remaining idle
 * window and the remaining absolute lifetime, so it can never outlive the
 * 12-hour deadline. The record is not authority on its own: every request
 * compares its epoch with `users.session_epoch` (V3), in the session service.
 *
 * The Redis key is the SHA-256 of the cookie value, never the value itself, so
 * a copy of the Redis data cannot be replayed as a cookie. The reverse index
 * `user_sessions:<user_id>` exists for cleanup and carries no security meaning.
 */

import { createHash } from 'node:crypto';

import { getRedis } from './redis.js';

/** @param {string} sessionId the `pa_sid` value @returns {string} */
const recordKey = (sessionId) => `session:${createHash('sha256').update(sessionId).digest('hex')}`;
const indexKey = (userId) => `user_sessions:${userId}`;

/**
 * @typedef {{ userId: number, sessionEpoch: number, absoluteExpiresAt: number }} SessionRecord
 *   `absoluteExpiresAt` in epoch milliseconds
 */

/**
 * @param {import('ioredis').Redis} [redis]
 */
export function createSessionStore(redis = getRedis()) {
  return {
    /**
     * @param {string} sessionId
     * @param {SessionRecord} record
     * @param {number} ttlSeconds
     */
    async create(sessionId, record, ttlSeconds) {
      const key = recordKey(sessionId);
      await redis
        .multi()
        .set(key, JSON.stringify(record), 'EX', ttlSeconds)
        .sadd(indexKey(record.userId), key)
        .exec();
    },

    /**
     * @param {string} sessionId
     * @returns {Promise<SessionRecord|null>}
     */
    async read(sessionId) {
      const raw = await redis.get(recordKey(sessionId));
      return raw ? JSON.parse(raw) : null;
    },

    /** Slide the idle window. */
    async touch(sessionId, ttlSeconds) {
      await redis.expire(recordKey(sessionId), ttlSeconds);
    },

    /** @param {string} sessionId @param {number} userId */
    async destroy(sessionId, userId) {
      const key = recordKey(sessionId);
      await redis.multi().del(key).srem(indexKey(userId), key).exec();
    },

    /** Remove every session of a user (best effort; the epoch is the authority). */
    async destroyAllForUser(userId) {
      const keys = await redis.smembers(indexKey(userId));
      await redis.del(...keys, indexKey(userId));
    },
  };
}
