/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Short-lived, single-use server-side state keyed by a secret the browser holds
 * (SDD v1.1 §4.10, §5.6): the OAuth `state` of a Google sign-in, and the
 * pending-registration nonce that stands for a Google identity while the person
 * chooses a username.
 *
 * The Redis key is the SHA-256 of the secret, never the secret itself. `take`
 * is an atomic read-and-delete, which is what makes a value single-use even
 * when two requests race for it.
 */

import { createHash } from 'node:crypto';

import { getRedis } from './redis.js';

const keyOf = (namespace, secret) => `${namespace}:${createHash('sha256').update(secret).digest('hex')}`;

/**
 * @param {import('ioredis').Redis} [redis]
 */
export function createFlowSecretStore(redis = getRedis()) {
  return {
    /** @param {string} namespace @param {string} secret @param {object} value @param {number} ttlSeconds */
    async put(namespace, secret, value, ttlSeconds) {
      await redis.set(keyOf(namespace, secret), JSON.stringify(value), 'EX', ttlSeconds);
    },

    /** Read and delete in one step. @returns {Promise<object|null>} */
    async take(namespace, secret) {
      const raw = await redis.getdel(keyOf(namespace, secret));
      return raw ? JSON.parse(raw) : null;
    },

    /** Read without consuming. @returns {Promise<object|null>} */
    async peek(namespace, secret) {
      const raw = await redis.get(keyOf(namespace, secret));
      return raw ? JSON.parse(raw) : null;
    },

    /** @returns {Promise<boolean>} whether this call removed it */
    async remove(namespace, secret) {
      return (await redis.del(keyOf(namespace, secret))) === 1;
    },
  };
}
