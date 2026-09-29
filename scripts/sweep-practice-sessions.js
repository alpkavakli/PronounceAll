/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Finalise practice sessions idle for 60 minutes or more (FR-PRACTICE-06).
 *
 * The recurring sweep's entry point until the worker tier exists (Threat Model
 * F4); a returning viewer already finalises their own stale session on arrival.
 * Safe to run at any time and repeatedly: only active, idle sessions change.
 *
 * Usage:
 *   node scripts/sweep-practice-sessions.js
 */

import { randomInt } from 'node:crypto';
import process from 'node:process';

import { closePool } from '../src/lib/mysql.js';
import { createPracticeQueueStore } from '../src/lib/practice-queue-store.js';
import { closeRedis } from '../src/lib/redis.js';
import { createPracticeService } from '../src/services/practice.service.js';

async function main() {
  const service = createPracticeService({
    queueStore: createPracticeQueueStore(),
    rng: () => randomInt(0, 2 ** 32) / 2 ** 32,
  });
  const finalised = await service.sweepIdleSessions();
  process.stdout.write(`Finalised ${finalised} idle practice session(s).\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    await closeRedis();
  });
