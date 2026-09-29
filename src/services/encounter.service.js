/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word encounter events (FR-SAVE-10; SDD v1.1 §3.4, §4.4 amendment 2026-09-17).
 *
 * Opening a canonical word's page is one `word_encounter` event for that word,
 * appended to the log and nothing else:
 *
 *   - eligible: a registered user, or an anonymous actor that ALREADY has a
 *     progress profile. Eligibility is re-checked here rather than trusting the
 *     hydration flag. A passive reader's request is a successful no-op and never
 *     creates a profile (FR-AUTH-03);
 *   - at most one per owner, word and UTC day, enforced by the V9 unique key; a
 *     repeat writes nothing and still succeeds;
 *   - only the canonical `word_id` and the time are stored: no search text,
 *     referrer or other free text;
 *   - derived save state is never touched (FR-SAVE-04).
 *
 * The write runs inside the §5.2 reservation pattern on the FR-SAVE-08
 * idempotency key, like the save write.
 */

import { AppError } from '../errors/index.js';
import {
  anonymousProfileExists,
  findBoundUserId,
  insertWordEncounter,
  targetExists,
} from '../repositories/progress.repository.js';

/**
 * @param {object} dependencies
 * @param {import('../lib/idempotency-store.js').IdempotencyStore} dependencies.idempotencyStore
 * @param {() => Date} [dependencies.clock]
 */
export function createEncounterService({ idempotencyStore, clock = () => new Date() }) {
  /**
   * @param {object} request
   * @param {string|null} request.anonymousId the viewer's `pa_uid`
   * @param {number|null} [request.userId] the signed-in user, always eligible
   * @param {number} request.wordId
   * @param {string} request.idempotencyKey
   * @returns {Promise<{ recorded: boolean, replayed: boolean }>}
   *   `recorded` is true only when this request wrote the event
   */
  async function recordEncounter({ anonymousId, userId = null, wordId, idempotencyKey }) {
    if (!(await targetExists('word', wordId))) {
      throw AppError.notFound('That word does not exist.');
    }
    if (userId === null && (!anonymousId || !(await anonymousProfileExists(anonymousId)))) {
      return { recorded: false, replayed: false };
    }

    // Keyed per identity, so one viewer's key can never replay another's result.
    const reservationKey = `encounter:${userId === null ? anonymousId : `user:${userId}`}:${idempotencyKey}`;
    const reservation = await idempotencyStore.reserve(reservationKey);
    if (reservation.status === 'completed') {
      return { ...reservation.result, replayed: true };
    }
    if (reservation.status === 'pending') {
      throw AppError.conflict('That visit is already being recorded.');
    }

    try {
      const ownerUserId = userId ?? (await findBoundUserId(anonymousId));
      const recorded = await insertWordEncounter({
        owner: ownerUserId === null ? { anonymousId } : { userId: ownerUserId },
        wordId,
        occurredAt: clock(),
      });
      const outcome = { recorded };
      await idempotencyStore.complete(reservationKey, outcome);
      return { ...outcome, replayed: false };
    } catch (error) {
      // A failed write must not suppress a genuine retry (SDD §5.2).
      await idempotencyStore.release(reservationKey);
      throw error;
    }
  }

  return { recordEncounter };
}
