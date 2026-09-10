/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SQL for `phonemes`, `phoneme_example_words`, and `pronunciation_phonemes`
 * (SDD v1.1 §4.2, §4.8; FR-IPA-01/02/03/08; decisions E1, E2; D4).
 *
 * Repositories own all database access and issue raw, parameterised SQL through
 * `mysql2` (C4, §7.4). Every function takes an optional executor as its last
 * argument so the same function serves a standalone read and a step inside the
 * seed transaction.
 */

import { defaultExecutor } from './transaction.js';

/** @param {object} row */
function toPhoneme(row) {
  return {
    phonemeId: row.phoneme_id,
    variantId: row.variant_id,
    ipaSymbol: row.ipa_symbol,
    frequencyRank: row.frequency_rank,
    audioAssetId: row.audio_asset_id,
    primaryExampleWordId: row.primary_example_word_id,
  };
}

/**
 * Insert or update one canonical unit on its natural key.
 *
 * `primary_example_word_id` is deliberately NOT written here: the pointer is set
 * by {@link setPrimaryExampleWord} once the example rows exist, which is how the
 * circular reference of SDD §4.2 is resolved at seed time.
 *
 * @param {object} phoneme
 * @param {object} [executor]
 * @returns {Promise<number>} the `phoneme_id`
 */
export async function upsertPhoneme(phoneme, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO phonemes (variant_id, ipa_symbol, frequency_rank, audio_asset_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       frequency_rank = VALUES(frequency_rank),
       audio_asset_id = VALUES(audio_asset_id)`,
    [phoneme.variantId, phoneme.ipaSymbol, phoneme.frequencyRank, phoneme.audioAssetId],
  );

  const [rows] = await executor.execute(
    'SELECT phoneme_id FROM phonemes WHERE variant_id = ? AND ipa_symbol = ?',
    [phoneme.variantId, phoneme.ipaSymbol],
  );
  return rows[0].phoneme_id;
}

/**
 * `frequency_rank` is UNIQUE per variant, so assigning a new ranking in place
 * collides with the ranks still held by other rows. Parking every rank in a
 * disjoint negative range first makes the reassignment order-independent.
 *
 * @param {number} variantId
 * @param {object} [executor]
 * @returns {Promise<void>}
 */
export async function parkFrequencyRanks(variantId, executor = defaultExecutor()) {
  await executor.execute(
    'UPDATE phonemes SET frequency_rank = -frequency_rank WHERE variant_id = ? AND frequency_rank > 0',
    [variantId],
  );
}

/**
 * @param {object} phoneme
 * @param {object} [executor]
 * @returns {Promise<void>}
 */
export async function setFrequencyRank(phoneme, executor = defaultExecutor()) {
  await executor.execute(
    'UPDATE phonemes SET frequency_rank = ? WHERE variant_id = ? AND ipa_symbol = ?',
    [phoneme.frequencyRank, phoneme.variantId, phoneme.ipaSymbol],
  );
}

/**
 * @param {number} phonemeId
 * @param {number} exampleWordId
 * @param {object} [executor]
 * @returns {Promise<void>}
 */
export async function setPrimaryExampleWord(phonemeId, exampleWordId, executor = defaultExecutor()) {
  await executor.execute(
    'UPDATE phonemes SET primary_example_word_id = ? WHERE phoneme_id = ?',
    [exampleWordId, phonemeId],
  );
}

/**
 * @param {object} example
 * @param {object} [executor]
 * @returns {Promise<number>} the `example_word_id`
 */
export async function upsertExampleWord(example, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO phoneme_example_words
       (phoneme_id, example_word, phonemic_transcription, match_mode, source_reference)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       phonemic_transcription = VALUES(phonemic_transcription),
       match_mode             = VALUES(match_mode),
       source_reference       = VALUES(source_reference)`,
    [
      example.phonemeId,
      example.exampleWord,
      example.phonemicTranscription,
      example.matchMode,
      example.sourceReference,
    ],
  );

  const [rows] = await executor.execute(
    'SELECT example_word_id FROM phoneme_example_words WHERE phoneme_id = ? AND example_word = ?',
    [example.phonemeId, example.exampleWord],
  );
  return rows[0].example_word_id;
}

/**
 * Every canonical unit for a variant, in the frequency order the learning pages
 * use (SDD §4.8: covered by `UNIQUE (variant_id, frequency_rank)`).
 *
 * @param {number} variantId
 * @param {object} [executor]
 * @returns {Promise<object[]>}
 */
export async function listPhonemes(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT phoneme_id, variant_id, ipa_symbol, frequency_rank, audio_asset_id,
            primary_example_word_id
       FROM phonemes
      WHERE variant_id = ?
      ORDER BY frequency_rank`,
    [variantId],
  );
  return rows.map(toPhoneme);
}

/**
 * The phoneme rows a word page needs, joined to their audio and displayed
 * example, keyed by the `phoneme_id` the markup carries.
 *
 * @param {number} variantId
 * @param {object} [executor]
 * @returns {Promise<object[]>}
 */
export async function listPhonemeDetails(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT p.phoneme_id, p.ipa_symbol, p.frequency_rank,
            e.example_word, e.phonemic_transcription, e.source_reference,
            a.storage_key, a.generation_status, a.attribution_text, a.licence_identifier
       FROM phonemes p
       LEFT JOIN phoneme_example_words e ON e.example_word_id = p.primary_example_word_id
       LEFT JOIN audio_assets a ON a.audio_asset_id = p.audio_asset_id
      WHERE p.variant_id = ?
      ORDER BY p.frequency_rank`,
    [variantId],
  );
  return rows.map((row) => ({
    phonemeId: row.phoneme_id,
    ipaSymbol: row.ipa_symbol,
    frequencyRank: row.frequency_rank,
    exampleWord: row.example_word,
    examplePhonemicTranscription: row.phonemic_transcription,
    exampleSourceReference: row.source_reference,
    audioStorageKey: row.generation_status === 'ready' ? row.storage_key : null,
    audioAttribution: row.attribution_text,
    audioLicence: row.licence_identifier,
  }));
}

/**
 * Replace the ordered occurrences of one pronunciation.
 *
 * Delete-then-insert rather than upsert: the occurrence list is a SEQUENCE, so a
 * re-seed whose tokenisation grew shorter must not leave orphaned tail rows
 * behind at higher positions.
 *
 * @param {number} pronunciationId
 * @param {Array<{position: number, phonemeId: number}>} occurrences
 * @param {object} [executor]
 * @returns {Promise<void>}
 */
export async function replacePronunciationPhonemes(
  pronunciationId,
  occurrences,
  executor = defaultExecutor(),
) {
  await executor.execute('DELETE FROM pronunciation_phonemes WHERE pronunciation_id = ?', [
    pronunciationId,
  ]);

  for (const occurrence of occurrences) {
    await executor.execute(
      'INSERT INTO pronunciation_phonemes (pronunciation_id, position, phoneme_id) VALUES (?, ?, ?)',
      [pronunciationId, occurrence.position, occurrence.phonemeId],
    );
  }
}

/**
 * The clickable occurrences for every pronunciation of one word, in order.
 *
 * This is the read SDD §5.3 performs instead of reparsing IPA: an indexed range
 * scan on the `(pronunciation_id, position)` primary key, joined to `phonemes`.
 *
 * Keyed by WORD rather than by a list of pronunciation ids on purpose. The word
 * page already knows the word, one statement serves it, and the query stays
 * fully parameterised — an `IN (...)` list would have to be built from the array
 * length, which is exactly the shape NFR-SEC-07 forbids in this layer.
 *
 * @param {number} wordId
 * @param {object} [executor]
 * @returns {Promise<object[]>}
 */
export async function findOccurrencesForWord(wordId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT pp.pronunciation_id, pp.position, pp.phoneme_id, p.ipa_symbol
       FROM pronunciation_phonemes pp
       JOIN word_pronunciations wp ON wp.pronunciation_id = pp.pronunciation_id
       JOIN phonemes p ON p.phoneme_id = pp.phoneme_id
      WHERE wp.word_id = ?
      ORDER BY wp.display_order, pp.position`,
    [wordId],
  );
  return rows.map((row) => ({
    pronunciationId: row.pronunciation_id,
    position: row.position,
    phonemeId: row.phoneme_id,
    ipaSymbol: row.ipa_symbol,
  }));
}

/**
 * @param {number} variantId
 * @param {object} [executor]
 * @returns {Promise<number>}
 */
export async function countPhonemes(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    'SELECT COUNT(*) AS total FROM phonemes WHERE variant_id = ?',
    [variantId],
  );
  return Number(rows[0].total);
}
