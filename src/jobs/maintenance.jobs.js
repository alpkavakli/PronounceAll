/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Routine expiry pruning (NFR-PRIV-02), run nightly by the maintenance worker
 * under the `pa_maint` credential (SDD v1.1 §4.9). Thin adapters (C4).
 *
 *   token-prune          expired verification, reset and email-change tokens
 *   session-index-prune  stale entries of the Redis session reverse index
 */

/**
 * @param {object} services
 * @param {ReturnType<import('../services/retention.service.js').createRetentionService>} services.retentionService
 * @returns {import('../lib/job-queue.js').JobDefinition[]}
 */
export function maintenanceJobs({ retentionService }) {
  return [
    {
      name: 'token-prune',
      repeat: { pattern: '0 4 * * *', tz: 'UTC' },
      run: async () => ({ deleted: await retentionService.pruneExpiredTokens() }),
    },
    {
      name: 'session-index-prune',
      repeat: { pattern: '15 4 * * *', tz: 'UTC' },
      run: async () => ({ removed: await retentionService.pruneSessionIndexes() }),
    },
  ];
}
