/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The append-only anonymous-to-account binding history (B1, C5, FR-AUTH-18/19;
 * SDD v1.1 §4.3, §5.1).
 *
 * The only write is an INSERT of a `LINK`. There is no UNLINK and no code path
 * that updates or deletes a binding. `UNIQUE (anonymous_id)` is the B1
 * invariant: an anonymous identity binds to at most one account, so a second
 * link attempt is refused by the database and reported here as `false`.
 */

import { defaultExecutor } from './transaction.js';

/**
 * @param {object} binding
 * @param {string} binding.anonymousId
 * @param {number} binding.userId
 * @param {Date} binding.occurredAt
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<boolean>} whether this call wrote the binding
 */
export async function insertLinkBinding({ anonymousId, userId, occurredAt }, executor = defaultExecutor()) {
  try {
    await executor.execute(
      `INSERT INTO identity_bindings (anonymous_id, user_id, event_type, occurred_at) VALUES (?, ?, 'LINK', ?)`,
      [anonymousId, userId, occurredAt],
    );
    return true;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' && String(error.message).includes('uq_identity_bindings_anonymous')) {
      return false;
    }
    throw error;
  }
}
