/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The worker tier's static guarantees (SDD v1.1 §4.9, §6.5; FR-SAVE-03, B1):
 * where deletion may live, the job schedules, and what an alert carries.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import { loadConfig } from '../../src/config/index.js';
import { appJobs } from '../../src/jobs/app.jobs.js';
import { backupJobs } from '../../src/jobs/backup.jobs.js';
import { erasureJobs } from '../../src/jobs/erasure.jobs.js';
import { maintenanceJobs } from '../../src/jobs/maintenance.jobs.js';
import { createOpsAlert } from '../../src/lib/ops-alert.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.js') ? [full] : [];
  });
}

describe('§4.9 — deletion lives only with the principals that may delete', () => {
  /** The user-data tables of the §4.9 grant set: history of record and everything derived from or owned by a person. */
  const USER_DATA_TABLES = [
    'users', 'user_accounts', 'auth_tokens', 'anonymous_profiles', 'identity_bindings', 'user_activity_events',
    'user_word_states', 'user_phoneme_states', 'sm2_states', 'practice_sessions', 'practice_attempts',
    'consent_records', 'word_requests', 'deletion_audit',
  ];

  test('user data is deleted only in the erasure (pa_erase) and retention (pa_maint) repositories', () => {
    const deleting = {};
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      const tables = USER_DATA_TABLES.filter((table) => text.includes(`DELETE FROM ${table} `) || text.includes(`DELETE a FROM ${table} `) || text.includes(`TRUNCATE ${table}`));
      if (tables.length) deleting[path.relative(SRC, file).split(path.sep).join('/')] = tables;
    }
    expect(Object.keys(deleting).sort()).toEqual(['repositories/erasure.repository.js', 'repositories/retention.repository.js']);
    expect(deleting['repositories/retention.repository.js']).toEqual(['auth_tokens']);
  });

  test('the retention repository touches auth_tokens only', () => {
    const sql = readFileSync(path.join(SRC, 'repositories', 'retention.repository.js'), 'utf8');
    expect([...sql.matchAll(/\b(?:FROM|INTO|UPDATE)\s+(\w+)/g)].map((match) => match[1])).toEqual(['auth_tokens']);
  });
});

describe('§6.5 — the schedules', () => {
  const noop = async () => 0;
  const all = [
    ...erasureJobs({ accountDeletionService: { purgeDueAccounts: noop }, dormancyService: { pruneDormantProfiles: noop } }),
    ...maintenanceJobs({ retentionService: { pruneExpiredTokens: noop, pruneSessionIndexes: noop } }),
    ...appJobs({ practiceService: { sweepIdleSessions: noop } }),
    ...backupJobs({ backupService: { runBackup: noop, runRestoreTest: noop } }),
  ];

  test('every job has a unique name and a UTC cron schedule', () => {
    expect(new Set(all.map((job) => job.name)).size).toBe(all.length);
    for (const job of all) {
      expect(job.repeat.tz).toBe('UTC');
      expect(job.repeat.pattern.split(' ')).toHaveLength(5);
    }
  });

  test('the account purge runs hourly — inside the 24-hour bound of FR-SET-08 — and the nightly jobs once a day', () => {
    const schedule = Object.fromEntries(all.map((job) => [job.name, job.repeat.pattern]));
    expect(schedule['account-purge']).toMatch(/^\d+ \* \* \* \*$/);
    for (const nightly of ['dormancy-prune', 'token-prune', 'session-index-prune', 'save-state-reconcile']) {
      expect(schedule[nightly]).toMatch(/^\d+ \d+ \* \* \*$/);
    }
    expect(schedule['practice-sweep']).toBe('*/15 * * * *');
    // NFR-OPS-01: nightly backups (RPO within 24 h); V6: a scheduled restore test, weekly.
    expect(schedule['database-backup']).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(schedule['restore-test']).toMatch(/^\d+ \d+ \* \* \d$/);
  });

  test('adapters only call their service and report its count', async () => {
    const [purge] = erasureJobs({ accountDeletionService: { purgeDueAccounts: async () => 3 }, dormancyService: { pruneDormantProfiles: noop } });
    expect(await purge.run()).toEqual({ erased: 3 });
  });
});

describe('§6.5 — the exhausted-retry alert', () => {
  test('carries the job and the error name and code, never the error message', async () => {
    const sent = [];
    const alert = createOpsAlert({ sendMail: async (message) => void sent.push(message), to: 'ops@example.test', worker: 'erasure' });
    await alert('account-purge', Object.assign(new Error("Duplicate entry 'person@example.test'"), { code: 'ER_DUP_ENTRY' }));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ops@example.test');
    expect(sent[0].subject).toContain('account-purge');
    expect(sent[0].text).toContain('ER_DUP_ENTRY');
    expect(sent[0].text).not.toContain('person@example.test');
  });

  test('without an address it logs only', async () => {
    const sent = [];
    await createOpsAlert({ sendMail: async (message) => void sent.push(message), to: '', worker: 'app' })('practice-sweep', new Error('x'));
    expect(sent).toHaveLength(0);
  });

  test('OPS_ALERT_EMAIL is optional for the web process and must be an address when set', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).opsAlertEmail).toBe('');
    expect(loadConfig({ NODE_ENV: 'development', OPS_ALERT_EMAIL: 'ops@example.test' }).opsAlertEmail).toBe('ops@example.test');
    expect(() => loadConfig({ NODE_ENV: 'development', OPS_ALERT_EMAIL: 'not an address' })).toThrow();
  });
});
