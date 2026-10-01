/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The backup worker (NFR-OPS-01; SDD decision V6; maintainer decision
 * 2026-10-01). It runs in its own image, built from the official MySQL image,
 * because it needs MySQL's `mysqldump` and, for the restore test, `mysqld`
 * (`Dockerfile.backup`). Its `MYSQL_USER` only reads; its bucket key writes
 * and lists but cannot delete, and the production role never holds it.
 *
 * Usage: node src/workers/backup.worker.js
 */

import { QUEUES } from '../lib/job-queue.js';
import { backupJobs } from '../jobs/backup.jobs.js';
import { buildBackupService } from './backup-components.js';
import { main, runWorker } from './run-worker.js';

main(() =>
  runWorker({
    worker: 'backup',
    queueName: QUEUES.BACKUP,
    buildJobs: () => backupJobs({ backupService: buildBackupService() }),
  }),
);
