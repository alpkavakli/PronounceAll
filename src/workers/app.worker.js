/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The app worker (FR-PRACTICE-06, FR-SAVE-04, B3; SDD v1.1 §6.5): recurring
 * work that needs only the runtime privileges. In production its `MYSQL_USER`
 * is the `pa_app` principal, like the web process.
 *
 * Usage: node src/workers/app.worker.js
 */

import { randomInt } from 'node:crypto';

import { QUEUES } from '../lib/job-queue.js';
import { createPracticeQueueStore } from '../lib/practice-queue-store.js';
import { appJobs } from '../jobs/app.jobs.js';
import { createPracticeService } from '../services/practice.service.js';
import { main, runWorker } from './run-worker.js';

main(() =>
  runWorker({
    worker: 'app',
    queueName: QUEUES.APP,
    buildJobs: () =>
      appJobs({
        // The sweep makes no random choice, but the service is one unit (NFR-SEC-12: CSPRNG).
        practiceService: createPracticeService({
          queueStore: createPracticeQueueStore(),
          rng: () => randomInt(0, 2 ** 32) / 2 ** 32,
        }),
      }),
  }),
);
