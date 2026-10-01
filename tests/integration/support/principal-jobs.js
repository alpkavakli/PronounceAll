/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The worker jobs, built exactly as the workers build them, for
 * database-principals.test.js to run in a child process under a given
 * MYSQL_USER (SDD v1.1 §4.9).
 */

import { config } from '../../../src/config/index.js';
import { createFlowSecretStore } from '../../../src/lib/flow-secret-store.js';
import { verifyPassword } from '../../../src/lib/passwords.js';
import { createPracticeQueueStore } from '../../../src/lib/practice-queue-store.js';
import { createSessionStore } from '../../../src/lib/session-store.js';
import { createAccountDeletionService } from '../../../src/services/account-deletion.service.js';
import { createDormancyService } from '../../../src/services/anonymous-dormancy.service.js';
import { createRetentionService } from '../../../src/services/retention.service.js';
import { createSessionService } from '../../../src/services/session.service.js';

export function buildPurge() {
  return createAccountDeletionService({
    passwords: { verifyPassword },
    sessionService: createSessionService({ store: createSessionStore() }),
    secrets: createFlowSecretStore(),
    practiceQueueStore: createPracticeQueueStore(),
    sendMail: async () => {
      throw new Error('no mail');
    },
    contactEmail: config.contactEmail,
  }).purgeDueAccounts();
}

export function buildDormancyPrune() {
  return createDormancyService({ practiceQueueStore: createPracticeQueueStore() }).pruneDormantProfiles();
}

export function buildTokenPrune() {
  return createRetentionService({ sessionStore: createSessionStore() }).pruneExpiredTokens();
}
