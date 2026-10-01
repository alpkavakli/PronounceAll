/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Facts about a database's shape, recorded with each backup and checked again
 * on the restored copy (NFR-OPS-01, V6). Read-only, and run against either the
 * live database or the scratch server of the restore test.
 */

import { defaultExecutor } from './transaction.js';

/** @returns {Promise<string[]>} the base tables of the connection's database, sorted */
export async function listBaseTables(executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.name);
}

/** @returns {Promise<string|null>} the latest successfully applied Flyway version */
export async function latestSchemaVersion(executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT version FROM flyway_schema_history
      WHERE success = 1 AND version IS NOT NULL
      ORDER BY installed_rank DESC LIMIT 1`,
  );
  return rows[0]?.version ?? null;
}
