/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Process entry point: binds the composition root to a port and owns the
 * process lifecycle. Kept separate from `app.js` so integration tests can
 * exercise the application through Supertest without opening a socket.
 */

import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { closePool } from './lib/mysql.js';
import { closeRedis } from './lib/redis.js';

const server = createApp().listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'PronounceAll listening');
});

/** @param {string} signal */
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await Promise.allSettled([closePool(), closeRedis()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
