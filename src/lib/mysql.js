/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The MySQL connection pool (SDD v1.1 §3.2, §3.3, §7.4).
 *
 * A shared infrastructure client constructed once at the composition root. Per
 * the C4 dependency rule, only repositories, adapters, and the composition root
 * consume it; business services never import it. MySQL 8 is the system of
 * record and the authority for session validity (V3).
 *
 * The connection `time_zone` is set to UTC explicitly (C5) so temporal values
 * are unambiguous regardless of the server locale.
 */

import mysql from 'mysql2/promise';

import { config } from '../config/index.js';

let pool;

/**
 * @returns {import('mysql2/promise').Pool} the lazily constructed shared pool
 */
export function getPool() {
  pool ??= mysql.createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    database: config.mysql.database,
    user: config.mysql.user,
    password: config.mysql.password,
    connectionLimit: config.mysql.connectionLimit,
    waitForConnections: true,
    timezone: 'Z',
    dateStrings: false,
    namedPlaceholders: false,
    // Multiple statements per query would defeat the parameterisation rule of
    // NFR-SEC-07; mysql2 defaults this off and it stays off explicitly.
    multipleStatements: false,
  });
  return pool;
}

/**
 * Set the session time zone to UTC on every pooled connection (C5).
 * Registered by the composition root once the pool exists.
 *
 * @param {import('mysql2/promise').Pool} target
 */
export function enforceUtcSessions(target) {
  target.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
}

/**
 * Liveness probe used by the health route. Deliberately trivial: it proves the
 * pool can acquire a connection and round-trip a statement, nothing more.
 *
 * @returns {Promise<boolean>} true when the database answers
 */
export async function pingDatabase() {
  const [rows] = await getPool().query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

/** Close the pool. Called on graceful shutdown and at the end of test runs. */
export async function closePool() {
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
