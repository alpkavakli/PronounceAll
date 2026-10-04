/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The transaction runner (SDD v1.1 §7.4, decision C4).
 *
 * The transaction BOUNDARY belongs to the service operation that knows what
 * must be atomic; the DRIVER work of opening, committing, and rolling one back
 * belongs to the data-access layer, which is the one layer allowed to hold a
 * `mysql2` handle. This module is that seam: a service calls `withTransaction`
 * and passes the resulting executor to the repository functions it wants inside
 * the boundary, without ever importing the pool itself.
 *
 * Every repository function in this layer takes an optional executor as its
 * last argument and defaults to the pool, so the same function serves both a
 * standalone read and a step inside a transaction.
 */

import { randomInt } from 'node:crypto';

import { getPool } from '../lib/mysql.js';

/**
 * An object exposing `query` and `execute` — either the pool or a single
 * connection enlisted in a transaction.
 *
 * @typedef {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} Executor
 */

/**
 * @returns {Executor} the default executor: the shared pool, no transaction
 */
export function defaultExecutor() {
  return getPool();
}

/** InnoDB's answers that mean "this transaction lost a lock race; run it again". */
const RETRYABLE_ERRNOS = new Set([
  1213, // ER_LOCK_DEADLOCK: InnoDB chose this transaction as the victim and rolled it back
  1205, // ER_LOCK_WAIT_TIMEOUT
]);
export const TRANSACTION_ATTEMPTS = 3;

/**
 * Run `work` inside a single MySQL transaction, committing on success and
 * rolling back on any throw. The connection is always returned to the pool.
 *
 * A transaction that loses a lock race (a deadlock or a lock-wait timeout) is
 * rolled back and run again, up to three times in all, after a short random
 * pause: concurrent writers that touch neighbouring index gaps — two learners'
 * first answers on the same word, say — deadlock under InnoDB's gap locking,
 * and MySQL's own guidance is to retry. That is only safe because of the rule
 * every caller keeps: `work` touches nothing but the transaction it is given.
 * Mail, Redis and other side effects happen after `withTransaction` returns.
 *
 * @template T
 * @param {(tx: Executor) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runOnce(work);
    } catch (error) {
      if (!RETRYABLE_ERRNOS.has(error?.errno) || attempt >= TRANSACTION_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, randomInt(5, 25) * attempt));
    }
  }
}

async function runOnce(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}
