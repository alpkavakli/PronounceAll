/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SQL for `word_requests` (SDD v1.1 §4.2, §4.8, FR-WORD-05).
 *
 * The runtime role `pa_app` holds `INSERT, UPDATE, SELECT` here and no `DELETE`
 * (SDD §4.9), which is exactly what this module needs.
 */

import { defaultExecutor } from './transaction.js';

/**
 * @typedef {object} WordRequestOutcome
 * @property {boolean} created  true when a new row was inserted, false when an
 *   existing request was up-voted
 * @property {number} requestId
 */

/**
 * Record a word request, or up-vote the existing one.
 *
 * FR-WORD-05 requires that a duplicate submission of the same variant and word
 * increment an up-vote counter rather than creating a second row. That is done
 * in ONE statement against `UNIQUE (variant_id, normalized_word)` rather than a
 * read-then-write, because two concurrent submissions of the same new word
 * would both see "absent" under a read-then-write and one would fail on the
 * unique key. The upsert makes the loser an up-vote instead, so concurrency is
 * handled by the constraint rather than by a race the application would lose.
 *
 * `submitted_by_anonymous_id` is only ever the `pa_uid` UUID; the form itself
 * captures no personal data (FR-WORD-05, SRS Appendix E).
 *
 * `LAST_INSERT_ID(request_id)` in the duplicate branch makes the driver report
 * the existing row's id. `affectedRows` distinguishes the branches: mysql2
 * reports 1 for an insert and 2 for an `ON DUPLICATE KEY` update.
 *
 * @param {object} request
 * @param {number} request.variantId
 * @param {string} request.normalizedWord
 * @param {string | null} request.submittedByAnonymousId
 * @param {number | null} [request.submittedByUserId] always null in Iteration 1
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<WordRequestOutcome>}
 */
export async function recordWordRequest(request, executor = defaultExecutor()) {
  const [result] = await executor.execute(
    `INSERT INTO word_requests (variant_id, normalized_word, submitted_by_user_id,
                                submitted_by_anonymous_id, upvote_count, status,
                                created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, 'open', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
          request_id   = LAST_INSERT_ID(request_id),
          upvote_count = upvote_count + 1,
          updated_at   = UTC_TIMESTAMP(3)`,
    [
      request.variantId,
      request.normalizedWord,
      request.submittedByUserId ?? null,
      request.submittedByAnonymousId,
    ],
  );
  return { created: result.affectedRows === 1, requestId: result.insertId };
}

/**
 * @param {number} variantId
 * @param {string} normalizedWord
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<{ requestId: number, upvoteCount: number, status: string } | null>}
 */
export async function findWordRequest(variantId, normalizedWord, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT request_id, upvote_count, status
       FROM word_requests
      WHERE variant_id = ? AND normalized_word = ?`,
    [variantId, normalizedWord],
  );
  return rows.length === 0
    ? null
    : {
        requestId: rows[0].request_id,
        upvoteCount: rows[0].upvote_count,
        status: rows[0].status,
      };
}
