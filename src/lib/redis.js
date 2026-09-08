/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Redis client (SDD v1.1 §3.2, V2).
 *
 * One self-hosted instance carries four workloads: the ephemeral rate-limit
 * counters and idempotency keys, and the durable sessions and BullMQ queues.
 * It runs with AOF persistence and a `noeviction` memory policy, so its memory
 * is a monitored signal rather than something left to evict silently.
 *
 * A shared infrastructure client per C4: consumed by adapters, middleware, and
 * the composition root, never imported by a business service.
 */

import Redis from 'ioredis';

import { config } from '../config/index.js';
import { logger } from './logger.js';

let client;

/**
 * @returns {import('ioredis').Redis} the lazily constructed shared client
 */
export function getRedis() {
  if (!client) {
    client = new Redis(config.redis.url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
    });
    client.on('error', (error) => {
      logger.error({ err: error }, 'Redis client error');
    });
  }
  return client;
}

/**
 * Liveness probe used by the health route.
 *
 * @returns {Promise<boolean>} true when Redis answers PING
 */
export async function pingRedis() {
  return (await getRedis().ping()) === 'PONG';
}

/** Close the client. Called on graceful shutdown and at the end of test runs. */
export async function closeRedis() {
  if (client) {
    const closing = client;
    client = undefined;
    await closing.quit();
  }
}
