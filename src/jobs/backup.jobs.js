/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The backup worker's jobs (NFR-OPS-01; SDD decision V6). Thin adapters (C4).
 *
 *   database-backup  nightly — RPO within 24 hours
 *   restore-test     weekly — the newest backup restores, and is recent
 */

/**
 * @param {object} services
 * @param {ReturnType<import('../services/backup.service.js').createBackupService>} services.backupService
 * @returns {import('../lib/job-queue.js').JobDefinition[]}
 */
export function backupJobs({ backupService }) {
  return [
    {
      name: 'database-backup',
      repeat: { pattern: '30 1 * * *', tz: 'UTC' },
      run: () => backupService.runBackup(),
    },
    {
      name: 'restore-test',
      repeat: { pattern: '0 5 * * 1', tz: 'UTC' },
      run: () => backupService.runRestoreTest(),
    },
  ];
}
