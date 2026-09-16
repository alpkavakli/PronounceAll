/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Derived save-state reconciliation from the command line (FR-SAVE-04).
 *
 * Usage:
 *   node scripts/reconcile-save-state.js           # dry run: report drift, change nothing
 *   node scripts/reconcile-save-state.js --apply   # repair drift (the scheduled job)
 */

import process from 'node:process';

import { runSaveStateReconciliation } from '../src/jobs/reconcile-save-state.job.js';
import { closePool } from '../src/lib/mysql.js';
import { reconcileSaveState } from '../src/services/state-reconciliation.service.js';

const out = (line) => process.stdout.write(`${line}
`);

async function main() {
  if (process.argv.includes('--apply')) {
    const summary = await runSaveStateReconciliation();
    out(`owners ${summary.owners}, drift ${summary.drift}, repaired ${summary.repaired}`);
    return;
  }

  const { owners, drift } = await reconcileSaveState();
  out(`Dry run: ${owners} owner(s), ${drift.length} drifted row(s). Nothing was changed.`);
  for (const entry of drift) {
    const who = 'userId' in entry.owner ? `user ${entry.owner.userId}` : `anonymous ${entry.owner.anonymousId}`;
    const want = entry.expected ? `${entry.expected.state}@${entry.expected.lastEventId}` : '-';
    const have = entry.live ? `${entry.live.state}@${entry.live.lastEventId}` : '-';
    out(`  ${entry.kind.padEnd(11)} ${who} ${entry.targetKind} ${entry.targetId}: expected ${want}, live ${have}`);
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}
`);
    process.exitCode = 1;
  })
  .finally(closePool);
