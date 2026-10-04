/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Accounts for the launch load test (NFR-PERF-08): its 20 signed-in users,
 * each with words saved and so due for practice.
 *
 * They cannot register through the site during the test: registration is
 * limited to 3 per hour per IP (Appendix C) and the load comes from one
 * machine. So they are created here, as registration creates them (a bcrypt
 * hash, the no-recovery acknowledgement), and their saves go through the same
 * event-plus-state write the save endpoint uses.
 *
 * Never in production. `--remove` marks them for erasure; the erasure worker's
 * hourly purge deletes them with everything they did during the test.
 *
 * Usage:
 *   LOAD_TEST_PASSWORD=<16+ chars> node scripts/load-test-users.js --create [--count=20] [--words=10]
 *   node scripts/load-test-users.js --remove
 */

import process from 'node:process';

import { config } from '../src/config/index.js';
import { closePool, getPool } from '../src/lib/mysql.js';
import { hashPassword } from '../src/lib/passwords.js';
import { insertPasswordAccount, insertUser, insertUserConsent } from '../src/repositories/accounts.repository.js';
import { insertActivityEvent, upsertTargetState } from '../src/repositories/progress.repository.js';
import { withTransaction } from '../src/repositories/transaction.js';

export const LOAD_TEST_PREFIX = 'loadtest';
const option = (name, fallback) => Number(process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);

async function create(count, words) {
  const password = process.env.LOAD_TEST_PASSWORD;
  if (typeof password !== 'string' || password.length < 16) throw new Error('Set LOAD_TEST_PASSWORD (at least 16 characters)');
  const passwordHash = await hashPassword(password);
  const [rows] = await getPool().query('SELECT word_id FROM words ORDER BY word_id LIMIT ?', [words]);
  const wordIds = rows.map((row) => Number(row.word_id));

  let created = 0;
  for (let i = 1; i <= count; i += 1) {
    const username = `${LOAD_TEST_PREFIX}${String(i).padStart(2, '0')}`;
    const [[existing]] = await getPool().execute('SELECT user_id FROM users WHERE username_lower = ?', [username]);
    if (existing) continue;
    await withTransaction(async (tx) => {
      const now = new Date();
      const userId = await insertUser({ username, now }, tx);
      await insertPasswordAccount({ userId, passwordHash, now }, tx);
      await insertUserConsent({ userId, consentType: 'no_recovery_ack', consentValue: 'acknowledged', now }, tx);
      for (const wordId of wordIds) {
        const owner = { userId };
        const eventId = await insertActivityEvent({ owner, targetKind: 'word', targetId: wordId, eventType: 'save', eventValue: null, occurredAt: now }, tx);
        await upsertTargetState({ owner, targetKind: 'word', targetId: wordId, state: 'saved', lastEventId: eventId, updatedAt: now }, tx);
      }
    });
    created += 1;
  }
  process.stdout.write(`Created ${created} load-test account(s) (${LOAD_TEST_PREFIX}01..${String(count).padStart(2, '0')}), ${wordIds.length} saved words each.\n`);
}

async function remove() {
  const [result] = await getPool().execute(
    `UPDATE users SET deletion_state = 'hard_delete_scheduled', hard_delete_scheduled_at = ?, session_epoch = session_epoch + 1
      WHERE username_lower LIKE ? AND deletion_state = 'none'`,
    [new Date(), `${LOAD_TEST_PREFIX}%`],
  );
  process.stdout.write(`Marked ${result.affectedRows} load-test account(s) for erasure; the hourly purge (or npm run account:purge-due) deletes them.\n`);
}

async function main() {
  if (config.env === 'production') throw new Error('Never in production: the load test runs against staging');
  if (process.argv.includes('--create')) await create(option('count', 20), option('words', 10));
  else if (process.argv.includes('--remove')) await remove();
  else throw new Error('Usage: load-test-users.js --create | --remove');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
