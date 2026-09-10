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

/**
 * Run `work` inside a single MySQL transaction, committing on success and
 * rolling back on any throw. The connection is always returned to the pool.
 *
 * @template T
 * @param {(tx: Executor) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
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
