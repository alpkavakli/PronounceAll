/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Jobs that need only the ordinary application privileges (`pa_app`, SDD v1.1
 * §4.9, §6.5), run by the app worker. Thin adapters (C4); each is also a
 * script for manual runs.
 *
 *   practice-sweep        every 15 minutes — finalise sessions idle 60 minutes
 *                         (FR-PRACTICE-06; `npm run practice:sweep`)
 *   save-state-reconcile  nightly — the B3 drift safety net (FR-SAVE-04;
 *                         `npm run reconcile:state:apply`)
 */

import { runSaveStateReconciliation } from './reconcile-save-state.job.js';

/**
 * @param {object} services
 * @param {{ sweepIdleSessions: () => Promise<number> }} services.practiceService
 * @returns {import('../lib/job-queue.js').JobDefinition[]}
 */
export function appJobs({ practiceService }) {
  return [
    {
      name: 'practice-sweep',
      repeat: { pattern: '*/15 * * * *', tz: 'UTC' },
      run: async () => ({ finalised: await practiceService.sweepIdleSessions() }),
    },
    {
      name: 'save-state-reconcile',
      repeat: { pattern: '0 2 * * *', tz: 'UTC' },
      run: () => runSaveStateReconciliation(),
    },
  ];
}
