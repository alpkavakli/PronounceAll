/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The two C6 erasure jobs (SDD v1.1 §4.9, §6.5), run by the erasure worker
 * under the `pa_erase` credential. Thin adapters (C4): the logic is the
 * services', shared with `npm run account:purge-due`.
 *
 *   account-purge   hourly — accounts due for erasure, well inside the
 *                   24-hour bound of FR-SET-08 / NFR-PRIV-03
 *   dormancy-prune  nightly — unbound anonymous identities idle 2 years
 *                   (NFR-PRIV-02)
 */

/**
 * @param {object} services
 * @param {{ purgeDueAccounts: () => Promise<number> }} services.accountDeletionService
 * @param {{ pruneDormantProfiles: () => Promise<number> }} services.dormancyService
 * @returns {import('../lib/job-queue.js').JobDefinition[]}
 */
export function erasureJobs({ accountDeletionService, dormancyService }) {
  return [
    {
      name: 'account-purge',
      repeat: { pattern: '5 * * * *', tz: 'UTC' },
      run: async () => ({ erased: await accountDeletionService.purgeDueAccounts() }),
    },
    {
      name: 'dormancy-prune',
      repeat: { pattern: '30 3 * * *', tz: 'UTC' },
      run: async () => ({ pruned: await dormancyService.pruneDormantProfiles() }),
    },
  ];
}
