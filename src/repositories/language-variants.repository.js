/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SQL for the `language_variants` table (SDD v1.1 §4.2, FR-CONTENT-06, E1).
 *
 * Repositories own all database access and issue raw, parameterised SQL through
 * `mysql2` (C4, §7.4). No other normal application layer talks to the driver,
 * and no user-controlled value is ever concatenated into a statement
 * (NFR-SEC-07).
 */

import { getPool } from '../lib/mysql.js';

/**
 * @typedef {object} LanguageVariant
 * @property {number} variantId
 * @property {string} code       e.g. `en-us`
 * @property {string} displayName e.g. `American English`
 * @property {boolean} isActive
 */

/** @param {object} row @returns {LanguageVariant} */
function toLanguageVariant(row) {
  return {
    variantId: row.variant_id,
    code: row.code,
    displayName: row.display_name,
    isActive: Boolean(row.is_active),
  };
}

/**
 * @returns {Promise<LanguageVariant[]>} active variants, ordered by code
 */
export async function findActiveVariants() {
  const [rows] = await getPool().query(
    `SELECT variant_id, code, display_name, is_active
       FROM language_variants
      WHERE is_active = TRUE
      ORDER BY code`,
  );
  return rows.map(toLanguageVariant);
}

/**
 * @param {string} code variant code, e.g. `en-us`
 * @returns {Promise<LanguageVariant | null>}
 */
export async function findVariantByCode(code) {
  const [rows] = await getPool().execute(
    `SELECT variant_id, code, display_name, is_active
       FROM language_variants
      WHERE code = ?`,
    [code],
  );
  return rows.length === 0 ? null : toLanguageVariant(rows[0]);
}
