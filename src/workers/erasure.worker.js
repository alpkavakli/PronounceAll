/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The erasure worker (FR-SET-08, NFR-PRIV-02; SDD v1.1 §4.9, §6.5, C6, V6):
 * the hard delete and the dormancy prune. In production its `MYSQL_USER` is
 * the `pa_erase` principal — the only credential that can DELETE user data.
 *
 * Usage: node src/workers/erasure.worker.js
 */

import { config } from '../config/index.js';
import { createFlowSecretStore } from '../lib/flow-secret-store.js';
import { QUEUES } from '../lib/job-queue.js';
import { verifyPassword } from '../lib/passwords.js';
import { createPracticeQueueStore } from '../lib/practice-queue-store.js';
import { createSessionStore } from '../lib/session-store.js';
import { erasureJobs } from '../jobs/erasure.jobs.js';
import { createAccountDeletionService } from '../services/account-deletion.service.js';
import { createDormancyService } from '../services/anonymous-dormancy.service.js';
import { createSessionService } from '../services/session.service.js';
import { main, runWorker } from './run-worker.js';

main(() =>
  runWorker({
    worker: 'erasure',
    queueName: QUEUES.ERASURE,
    buildJobs: () => {
      const practiceQueueStore = createPracticeQueueStore();
      return erasureJobs({
        accountDeletionService: createAccountDeletionService({
          passwords: { verifyPassword },
          sessionService: createSessionService({ store: createSessionStore() }),
          secrets: createFlowSecretStore(),
          practiceQueueStore,
          // The purge sends no email (§5.5).
          sendMail: async () => {
            throw new Error('The erasure worker sends no user email');
          },
          contactEmail: config.contactEmail,
        }),
        dormancyService: createDormancyService({ practiceQueueStore }),
      });
    },
  }),
);
