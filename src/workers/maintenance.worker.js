/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The maintenance worker (NFR-PRIV-02; SDD v1.1 §4.9, §6.5): routine expiry
 * pruning. In production its `MYSQL_USER` is the `pa_maint` principal —
 * `SELECT, DELETE` on `auth_tokens` and nothing else.
 *
 * Usage: node src/workers/maintenance.worker.js
 */

import { QUEUES } from '../lib/job-queue.js';
import { createSessionStore } from '../lib/session-store.js';
import { maintenanceJobs } from '../jobs/maintenance.jobs.js';
import { createRetentionService } from '../services/retention.service.js';
import { main, runWorker } from './run-worker.js';

main(() =>
  runWorker({
    worker: 'maintenance',
    queueName: QUEUES.MAINTENANCE,
    buildJobs: () => maintenanceJobs({ retentionService: createRetentionService({ sessionStore: createSessionStore() }) }),
  }),
);
