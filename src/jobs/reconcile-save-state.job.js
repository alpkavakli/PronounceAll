/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The scheduled derived-state reconciliation (FR-SAVE-04, B3; SDD v1.1 §6.5).
 *
 * A thin adapter (C4): the logic is `reconcileSaveState`, shared with the
 * dry-run script. The app worker runs it nightly (`app.jobs.js`); a manual run
 * is `npm run reconcile:state:apply`.
 */

import { logger } from '../lib/logger.js';
import { reconcileSaveState } from '../services/state-reconciliation.service.js';

/**
 * @returns {Promise<{ owners: number, drift: number, repaired: number }>}
 */
export async function runSaveStateReconciliation() {
  const result = await reconcileSaveState({ apply: true });
  const summary = { owners: result.owners, drift: result.drift.length, repaired: result.repaired };
  // Identifiers only: owners are pseudonymous ids and targets are catalogue ids.
  if (result.drift.length > 0) {
    logger.warn({ ...summary, kinds: result.drift.map((entry) => entry.kind) }, 'Derived save state drift repaired');
  } else {
    logger.info(summary, 'Derived save state matches the event log');
  }
  return summary;
}
