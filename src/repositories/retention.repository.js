/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Routine expiry pruning (NFR-PRIV-02; SDD v1.1 §4.9).
 *
 * Called only by the maintenance worker, which in production runs under the
 * `pa_maint` credential: `SELECT, DELETE` on `auth_tokens` and nothing else.
 * Deliberately separate from the erasure module, so its blast radius is one
 * table.
 */

import { defaultExecutor } from './transaction.js';

/**
 * Delete every token past its expiry — used or not; an expired token can
 * never be redeemed, so it has no reason to stay.
 *
 * @param {Date} now
 * @returns {Promise<number>} how many were deleted
 */
export async function deleteExpiredTokens(now, executor = defaultExecutor()) {
  const [result] = await executor.execute('DELETE FROM auth_tokens WHERE expires_at < ?', [now]);
  return result.affectedRows;
}
