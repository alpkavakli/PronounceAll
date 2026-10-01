/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The dormancy prune (NFR-PRIV-02; SDD v1.1 §4.9, §6.5, C6, ledger 14).
 *
 * An anonymous identity that no account has bound, and that has not been seen
 * for two years — the `pa_uid` cookie's longest sliding lifetime, after which no
 * browser can still present it — is erased with everything it owns. A bound
 * identity is never pruned: it follows its account.
 *
 * The same shape as the hard delete: the predicate only selects candidates;
 * a per-profile compare-and-set claim, in the same transaction as the erasure,
 * decides. So concurrent runs are safe, a crash rolls everything back, and a
 * retry starts clean. Each pruned identity leaves a tombstone of type
 * `dormancy_anonymous` with no personal data. Live practice queues are cleared
 * after commit.
 */

import { randomUUID } from 'node:crypto';

import {
  claimDormantProfile,
  deleteAnonymousProfile,
  insertDeletionTombstone,
  listDormantCandidates,
  listPracticeSessionIds,
  orphanAnonymousWordRequests,
  purgeOwnerData,
} from '../repositories/erasure.repository.js';
import { withTransaction } from '../repositories/transaction.js';

export const DORMANCY_YEARS = 2;
const BATCH_SIZE = 500;

/** Two calendar years before `now`. */
export function dormancyCutoff(now) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - DORMANCY_YEARS);
  return cutoff;
}

/**
 * @param {object} dependencies
 * @param {{ remove: (sessionId: number) => Promise<void> }} dependencies.practiceQueueStore
 * @param {() => Date} [dependencies.clock]
 */
export function createDormancyService({ practiceQueueStore, clock = () => new Date() }) {
  /**
   * Prune every dormant unbound identity, in batches until none is left.
   *
   * @returns {Promise<number>} how many identities this run erased
   */
  async function pruneDormantProfiles() {
    let pruned = 0;
    for (;;) {
      const candidates = await listDormantCandidates(dormancyCutoff(clock()), BATCH_SIZE);
      let claimedInBatch = 0;
      for (const anonymousId of candidates) {
        const outcome = await withTransaction(async (tx) => {
          const now = clock();
          if (!(await claimDormantProfile(anonymousId, dormancyCutoff(now), now, tx))) return null;
          const practiceSessionIds = await listPracticeSessionIds(null, [anonymousId], tx);
          await purgeOwnerData({ anonymousId }, tx);
          await orphanAnonymousWordRequests(anonymousId, tx);
          await deleteAnonymousProfile(anonymousId, tx);
          await insertDeletionTombstone({ deletionId: randomUUID(), deletionType: 'dormancy_anonymous', now: clock() }, tx);
          return { practiceSessionIds };
        });
        if (!outcome) continue;
        claimedInBatch += 1;
        for (const sessionId of outcome.practiceSessionIds) await practiceQueueStore.remove(sessionId).catch(() => {});
      }
      pruned += claimedInBatch;
      // A short batch is the last one; a batch another run took entirely ends this run.
      if (candidates.length < BATCH_SIZE || claimedInBatch === 0) return pruned;
    }
  }

  return { pruneDormantProfiles };
}
