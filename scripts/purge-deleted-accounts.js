/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Erase every account whose deletion is due (FR-SET-08, NFR-PRIV-03): a direct
 * hard delete, or a soft delete whose 30-day window has passed.
 *
 * The hard-delete job's entry point until the worker tier exists (Threat Model
 * F4). It must run at least daily to meet the 24-hour bound, and in production
 * under the dedicated `pa_erase` database credential (SDD §4.9) — the runtime
 * `pa_app` principal holds no DELETE. Safe to run at any time, repeatedly and
 * concurrently: each account is claimed by compare-and-set before it is erased.
 * It sends no email; the one confirmation went out when deletion was requested.
 *
 * Usage:
 *   node scripts/purge-deleted-accounts.js
 */

import process from 'node:process';

import { config } from '../src/config/index.js';
import { createFlowSecretStore } from '../src/lib/flow-secret-store.js';
import { closePool } from '../src/lib/mysql.js';
import { verifyPassword } from '../src/lib/passwords.js';
import { createPracticeQueueStore } from '../src/lib/practice-queue-store.js';
import { closeRedis } from '../src/lib/redis.js';
import { createSessionStore } from '../src/lib/session-store.js';
import { createAccountDeletionService } from '../src/services/account-deletion.service.js';
import { createSessionService } from '../src/services/session.service.js';

async function main() {
  const service = createAccountDeletionService({
    passwords: { verifyPassword },
    sessionService: createSessionService({ store: createSessionStore() }),
    secrets: createFlowSecretStore(),
    practiceQueueStore: createPracticeQueueStore(),
    // The job never sends mail (SDD §5.5).
    sendMail: async () => {
      throw new Error('The purge job sends no email');
    },
    contactEmail: config.contactEmail,
  });
  const erased = await service.purgeDueAccounts();
  process.stdout.write(`Erased ${erased} account(s).\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    await closeRedis();
  });
