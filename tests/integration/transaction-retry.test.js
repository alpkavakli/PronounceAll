/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Transactions that lose a lock race are run again (SDD v1.1 §7.4; found by
 * the NFR-PERF-08 load test, Iteration 7 slice 5: concurrent practice answers
 * deadlocked under InnoDB gap locking).
 *
 * A real deadlock is provoked: two transactions lock two rows in opposite
 * orders, each waiting for the other; InnoDB kills one, and the retry must let
 * both finish.
 */

import { afterAll, describe, expect, test } from '@jest/globals';

const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { TRANSACTION_ATTEMPTS, withTransaction } = await import('../../src/repositories/transaction.js');

const ids = [];

afterAll(async () => {
  for (const id of ids) await getPool().execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [id]);
  await closePool();
});

async function profile() {
  const id = generateAnonymousId();
  ids.push(id);
  const now = new Date();
  await getPool().execute('INSERT INTO anonymous_profiles (anonymous_id, created_at, last_seen_at) VALUES (?, ?, ?)', [id, now, now]);
  return id;
}

const lock = (tx, id) => tx.execute('SELECT anonymous_id FROM anonymous_profiles WHERE anonymous_id = ? FOR UPDATE', [id]);

describe('withTransaction — lock races', () => {
  test('a real deadlock: the victim is rolled back and run again, and both transactions finish', async () => {
    const [a, b] = [await profile(), await profile()];
    let firstHeld = 0;
    let release;
    const bothHoldFirst = new Promise((resolve) => {
      release = resolve;
    });
    const attempts = { one: 0, two: 0 };

    const crossing = (name, first, second) =>
      withTransaction(async (tx) => {
        attempts[name] += 1;
        await lock(tx, first);
        if (attempts[name] === 1) {
          firstHeld += 1;
          if (firstHeld === 2) release();
          await bothHoldFirst; // each now holds one row and wants the other's
        }
        await lock(tx, second);
        await tx.execute('UPDATE anonymous_profiles SET last_seen_at = ? WHERE anonymous_id = ?', [new Date(), first]);
        return name;
      });

    const results = await Promise.all([crossing('one', a, b), crossing('two', b, a)]);
    expect(results).toEqual(['one', 'two']);
    // Exactly one of them was the deadlock victim and ran a second time.
    expect(attempts.one + attempts.two).toBe(3);
  }, 30_000);

  test('an ordinary error is not retried', async () => {
    let calls = 0;
    await expect(
      withTransaction(async () => {
        calls += 1;
        throw Object.assign(new Error('Duplicate entry'), { errno: 1062 });
      }),
    ).rejects.toThrow('Duplicate entry');
    expect(calls).toBe(1);
  });

  test('a deadlock that keeps happening gives up after the last attempt, with the error', async () => {
    let calls = 0;
    await expect(
      withTransaction(async () => {
        calls += 1;
        throw Object.assign(new Error('Deadlock found when trying to get lock'), { errno: 1213, code: 'ER_LOCK_DEADLOCK' });
      }),
    ).rejects.toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
    expect(calls).toBe(TRANSACTION_ATTEMPTS);
  });

  test('after a rolled-back attempt, the retry commits', async () => {
    const id = await profile();
    let calls = 0;
    await withTransaction(async (tx) => {
      calls += 1;
      await tx.execute('UPDATE anonymous_profiles SET last_seen_at = ? WHERE anonymous_id = ?', [new Date('2001-01-01T00:00:00Z'), id]);
      if (calls === 1) throw Object.assign(new Error('deadlock'), { errno: 1213 });
    });
    const [[row]] = await getPool().execute('SELECT last_seen_at FROM anonymous_profiles WHERE anonymous_id = ?', [id]);
    expect(row.last_seen_at.toISOString()).toBe('2001-01-01T00:00:00.000Z');
    expect(calls).toBe(2);
  });
});
