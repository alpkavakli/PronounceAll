/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Run one backup job now, outside the schedule: before a risky migration, or
 * to prove the restore path. The same service as the scheduled worker.
 *
 * Usage, in the backup image:
 *   docker compose --profile backup run --rm worker-backup src/workers/backup-once.js backup
 *   docker compose --profile backup run --rm worker-backup src/workers/backup-once.js restore-test
 */

import process from 'node:process';

import { closePool, enforceUtcSessions, getPool } from '../lib/mysql.js';
import { buildBackupService } from './backup-components.js';

const JOBS = Object.freeze({
  backup: (service) => service.runBackup(),
  'restore-test': (service) => service.runRestoreTest(),
});

async function main() {
  const job = JOBS[process.argv[2]];
  if (!job) throw new Error(`Usage: backup-once.js <${Object.keys(JOBS).join('|')}>`);
  enforceUtcSessions(getPool());
  const result = await job(buildBackupService());
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
