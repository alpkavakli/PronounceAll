/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Routine expiry pruning (NFR-PRIV-02): the nightly rows of the retention
 * table that are not erasure. Expired verification, reset and email-change
 * tokens are deleted (`pa_maint`, §4.9); expired sessions leave Redis by TTL,
 * and their stale reverse-index entries are dropped here.
 */

import { deleteExpiredTokens } from '../repositories/retention.repository.js';

/**
 * @param {object} dependencies
 * @param {{ pruneIndexes: () => Promise<number> }} dependencies.sessionStore
 * @param {() => Date} [dependencies.clock]
 */
export function createRetentionService({ sessionStore, clock = () => new Date() }) {
  return {
    /** @returns {Promise<number>} tokens deleted */
    pruneExpiredTokens: () => deleteExpiredTokens(clock()),
    /** @returns {Promise<number>} stale session-index entries removed */
    pruneSessionIndexes: () => sessionStore.pruneIndexes(),
  };
}
