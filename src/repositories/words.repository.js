/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SQL for `words` and `word_pronunciations` (SDD v1.1 §4.2, §4.8, decision E4).
 *
 * Repositories own all database access and issue raw, parameterised SQL through
 * `mysql2` (C4, §7.4). The reads here are the word-page shell composition of
 * SDD §5.3 and carry the NFR-PERF-05 budget: the headword lookup rides the
 * `UNIQUE (variant_id, normalized_headword)` key and the ordered transcriptions
 * ride `UNIQUE (word_id, display_order)`, so neither is a scan.
 *
 * Iteration 1 selects no audio column: `whole_word_audio_asset_id` does not
 * exist yet and whole-word audio is entirely Iteration 2.
 */

import { defaultExecutor } from './transaction.js';

/**
 * @typedef {object} WordRow
 * @property {number} wordId
 * @property {number} variantId
 * @property {string} normalizedHeadword
 * @property {string} displayHeadword
 * @property {string} meaning
 * @property {string} sourceUrl
 * @property {string} sourceLicence
 * @property {Date} retrievedAt
 */

/**
 * @typedef {object} PronunciationRow
 * @property {number} pronunciationId
 * @property {string} ipaTranscription
 * @property {string} syllableBreakdown
 * @property {string | null} gloss
 * @property {boolean} isPrimary
 * @property {number} displayOrder
 */

/** @param {object} row @returns {WordRow} */
function toWord(row) {
  return {
    wordId: row.word_id,
    variantId: row.variant_id,
    normalizedHeadword: row.normalized_headword,
    displayHeadword: row.display_headword,
    meaning: row.meaning,
    sourceUrl: row.source_url,
    sourceLicence: row.source_licence,
    retrievedAt: row.retrieved_at,
  };
}

/** @param {object} row @returns {PronunciationRow} */
function toPronunciation(row) {
  return {
    pronunciationId: row.pronunciation_id,
    ipaTranscription: row.ipa_transcription,
    syllableBreakdown: row.syllable_breakdown,
    gloss: row.gloss,
    isPrimary: Boolean(row.is_primary),
    displayOrder: row.display_order,
  };
}

/**
 * Look up one headword in one variant. The first query of the SDD §5.3 shell
 * composition.
 *
 * @param {number} variantId
 * @param {string} normalizedHeadword canonical slug from the validator
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<WordRow | null>}
 */
export async function findWordByHeadword(
  variantId,
  normalizedHeadword,
  executor = defaultExecutor(),
) {
  const [rows] = await executor.execute(
    `SELECT word_id, variant_id, normalized_headword, display_headword,
            meaning, source_url, source_licence, retrieved_at
       FROM words
      WHERE variant_id = ? AND normalized_headword = ?`,
    [variantId, normalizedHeadword],
  );
  return rows.length === 0 ? null : toWord(rows[0]);
}

/**
 * All pronunciations of one word in `display_order` (FR-WORD-03, SDD §5.3).
 * Ingestion assigns the primary the lowest `display_order`, so ordering by that
 * column alone puts the primary first while still riding the declared index.
 *
 * @param {number} wordId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<PronunciationRow[]>}
 */
export async function findPronunciationsByWordId(wordId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT p.pronunciation_id, p.ipa_transcription, p.syllable_breakdown,
            p.gloss, p.is_primary, p.display_order,
            a.storage_key, a.generation_status
       FROM word_pronunciations p
       LEFT JOIN audio_assets a ON a.audio_asset_id = p.whole_word_audio_asset_id
      WHERE p.word_id = ?
      ORDER BY p.display_order`,
    [wordId],
  );
  return rows.map((row) => ({
    ...toPronunciation(row),
    // SDD §4.12: only an asset that corresponds to THIS pronunciation, and only
    // once it is actually playable. A pending asset yields no control.
    audioStorageKey: row.generation_status === 'ready' ? row.storage_key : null,
  }));
}

/**
 * Every headword in a variant, for the E3 fuzzy-suggestion candidate set. Off
 * the hot path: it feeds a cached in-process list consulted only on a 404.
 *
 * @param {number} variantId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Array<{ normalizedHeadword: string, displayHeadword: string }>>}
 */
export async function listHeadwords(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT normalized_headword, display_headword
       FROM words
      WHERE variant_id = ?
      ORDER BY normalized_headword`,
    [variantId],
  );
  return rows.map((row) => ({
    normalizedHeadword: row.normalized_headword,
    displayHeadword: row.display_headword,
  }));
}

/**
 * @param {number} variantId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>} how many headwords the variant holds (FR-WORD-10)
 */
export async function countWords(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    'SELECT COUNT(*) AS total FROM words WHERE variant_id = ?',
    [variantId],
  );
  return Number(rows[0].total);
}

/**
 * Insert or converge one word on its E4 natural key
 * `UNIQUE (variant_id, normalized_headword)`, so a seed re-run updates the row
 * in place rather than duplicating it (E1, FR-CONTENT-01).
 *
 * `LAST_INSERT_ID(word_id)` in the duplicate branch makes the driver report the
 * existing row's id, which is what lets one statement serve both branches.
 *
 * @param {object} word
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>} the word id, inserted or existing
 */
export async function upsertWord(word, executor = defaultExecutor()) {
  const [result] = await executor.execute(
    `INSERT INTO words (variant_id, normalized_headword, display_headword,
                        meaning, source_url, source_licence, retrieved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
          word_id          = LAST_INSERT_ID(word_id),
          display_headword = VALUES(display_headword),
          meaning          = VALUES(meaning),
          source_url       = VALUES(source_url),
          source_licence   = VALUES(source_licence),
          retrieved_at     = VALUES(retrieved_at)`,
    [
      word.variantId,
      word.normalizedHeadword,
      word.displayHeadword,
      word.meaning,
      word.sourceUrl,
      word.sourceLicence,
      word.retrievedAt,
    ],
  );
  return result.insertId;
}

/**
 * Insert or converge one pronunciation on its E4 natural key
 * `UNIQUE (word_id, ipa_transcription)`. `is_primary` and `display_order` are
 * updated by the upsert but are not the row's content identity, so a re-run
 * that reorders pronunciations converges rather than re-identifying them.
 *
 * @param {object} pronunciation
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<void>}
 */
export async function upsertPronunciation(pronunciation, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO word_pronunciations (word_id, ipa_transcription, syllable_breakdown,
                                      gloss, is_primary, display_order)
          VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
          syllable_breakdown = VALUES(syllable_breakdown),
          gloss              = VALUES(gloss),
          is_primary         = VALUES(is_primary),
          display_order      = VALUES(display_order)`,
    [
      pronunciation.wordId,
      pronunciation.ipaTranscription,
      pronunciation.syllableBreakdown,
      pronunciation.gloss ?? null,
      pronunciation.isPrimary,
      pronunciation.displayOrder,
    ],
  );
}

/**
 * Remove one pronunciation of one word by its natural key, so a seed re-run
 * that drops a transcription converges rather than leaving an orphan behind.
 *
 * Deliberately one statement per stale row rather than a `NOT IN (...)` list
 * built at call time: a generated placeholder list would be dynamically
 * assembled SQL, which §7.4 and NFR-SEC-07 rule out, and the stale set on a
 * re-seed is at most a couple of rows per word. It also keeps
 * `pronunciation_id` stable across re-runs, which matters once Iteration 2's
 * `pronunciation_phonemes` references it.
 *
 * Runs under the `pa_seed` content credential, not the runtime `pa_app` role,
 * which holds no DELETE on any table (SDD §4.9).
 *
 * @param {number} wordId
 * @param {string} ipaTranscription
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>} rows removed, 0 or 1
 */
export async function deletePronunciationByIpa(
  wordId,
  ipaTranscription,
  executor = defaultExecutor(),
) {
  const [result] = await executor.execute(
    'DELETE FROM word_pronunciations WHERE word_id = ? AND ipa_transcription = ?',
    [wordId, ipaTranscription],
  );
  return result.affectedRows;
}

/**
 * Every word in a variant, for the Iteration 2 reconciliation pass.
 *
 * @param {number} variantId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Array<{ wordId: number, normalizedHeadword: string }>>}
 */
export async function listWordsForVariant(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT word_id, normalized_headword
       FROM words
      WHERE variant_id = ?
      ORDER BY word_id`,
    [variantId],
  );
  return rows.map((row) => ({
    wordId: row.word_id,
    normalizedHeadword: row.normalized_headword,
  }));
}

/**
 * Every pronunciation in a variant, for the D4 occurrence count and the
 * `pronunciation_phonemes` population pass.
 *
 * @param {number} variantId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Array<{ pronunciationId: number, wordId: number, ipaTranscription: string }>>}
 */
export async function listAllPronunciations(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT p.pronunciation_id, p.word_id, p.ipa_transcription
       FROM word_pronunciations p
       JOIN words w ON w.word_id = p.word_id
      WHERE w.variant_id = ?
      ORDER BY p.pronunciation_id`,
    [variantId],
  );
  return rows.map((row) => ({
    pronunciationId: row.pronunciation_id,
    wordId: row.word_id,
    ipaTranscription: row.ipa_transcription,
  }));
}

/**
 * Rewrite one pronunciation's transcription to its canonical form (D4 §5).
 *
 * The transcription is the row's natural key, so this is the one update that
 * changes identity. It is safe because reconciliation maps each source row to
 * exactly one canonical form and the unique key rejects a collision rather than
 * silently merging two rows.
 *
 * @param {number} pronunciationId
 * @param {string} ipaTranscription
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<void>}
 */
export async function updatePronunciationTranscription(
  pronunciationId,
  ipaTranscription,
  executor = defaultExecutor(),
) {
  await executor.execute(
    'UPDATE word_pronunciations SET ipa_transcription = ? WHERE pronunciation_id = ?',
    [ipaTranscription, pronunciationId],
  );
}

/**
 * Remove one pronunciation by id.
 *
 * Used by the D4 §5.7 reconciliation to drop a runtime row the canonical
 * inventory cannot represent. `pronunciation_phonemes` references this row, so
 * its occurrences are cleared first — the RESTRICT foreign key of SDD §4.9 would
 * otherwise refuse, which is the intended safety net rather than an obstacle.
 *
 * @param {number} pronunciationId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>} rows removed, 0 or 1
 */
export async function deletePronunciationById(pronunciationId, executor = defaultExecutor()) {
  await executor.execute('DELETE FROM pronunciation_phonemes WHERE pronunciation_id = ?', [
    pronunciationId,
  ]);
  const [result] = await executor.execute(
    'DELETE FROM word_pronunciations WHERE pronunciation_id = ?',
    [pronunciationId],
  );
  return result.affectedRows;
}

/**
 * Promote or demote one pronunciation's primary flag.
 *
 * `UNIQUE (word_id, is_primary_flag)` permits at most one primary per word, so
 * a caller promoting a row must have already demoted or removed the incumbent.
 *
 * @param {number} pronunciationId
 * @param {boolean} isPrimary
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<void>}
 */
export async function setPronunciationPrimary(
  pronunciationId,
  isPrimary,
  executor = defaultExecutor(),
) {
  await executor.execute(
    'UPDATE word_pronunciations SET is_primary = ? WHERE pronunciation_id = ?',
    [isPrimary ? 1 : 0, pronunciationId],
  );
}
