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

/**
 * Every phoneme across EVERY variant, for the global `/learnIPA` page
 * (FR-IPA-10).
 *
 * Carries the variant code as the marker that requirement asks each row to
 * show. Ordering is by frequency rank first so the page reads as one ranked
 * inventory rather than as variants concatenated; the variant code breaks ties
 * deterministically once a second variant exists.
 *
 * In v1.0 this returns exactly the `en-us` rows, because `en-us` is the only
 * seeded variant — which is the point of locking the URL now (FR-IPA-10).
 *
 * @param {object} [executor]
 * @returns {Promise<object[]>}
 */
export async function listAllPhonemeDetails(executor = defaultExecutor()) {
  const [rows] = await executor.query(
    `SELECT p.phoneme_id, p.ipa_symbol, p.frequency_rank,
            v.code AS variant_code, v.display_name AS variant_name,
            e.example_word, e.phonemic_transcription, e.source_reference,
            a.storage_key, a.generation_status, a.attribution_text, a.licence_identifier
       FROM phonemes p
       JOIN language_variants v ON v.variant_id = p.variant_id
       LEFT JOIN phoneme_example_words e ON e.example_word_id = p.primary_example_word_id
       LEFT JOIN audio_assets a ON a.audio_asset_id = p.audio_asset_id
      WHERE v.is_active = TRUE
      ORDER BY p.frequency_rank, v.code`,
  );
  return rows.map((row) => ({
    phonemeId: row.phoneme_id,
    ipaSymbol: row.ipa_symbol,
    frequencyRank: row.frequency_rank,
    variantCode: row.variant_code,
    variantName: row.variant_name,
    exampleWord: row.example_word,
    examplePhonemicTranscription: row.phonemic_transcription,
    exampleSourceReference: row.source_reference,
    audioStorageKey: row.generation_status === 'ready' ? row.storage_key : null,
    audioAttribution: row.attribution_text,
    audioLicence: row.licence_identifier,
  }));
}

/**
 * Point one canonical unit at a different audio asset.
 *
 * The promotion step of the hybrid audio policy: a replacement is fetched,
 * validated and stored well before this runs, and only a maintainer's listening
 * verdict causes the pointer to move. Both assets survive — the superseded one
 * stays on disk and in `audio_assets`, so a promotion is auditable and
 * reversible by pointing the row back.
 *
 * Returns the PREVIOUS asset id, or null when the unit does not exist, so a
 * caller cannot report a promotion that did not happen.
 *
 * @param {number} variantId
 * @param {string} ipaSymbol
 * @param {number} audioAssetId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number|null>}
 */
export async function repointPhonemeAudio(
  variantId,
  ipaSymbol,
  audioAssetId,
  executor = defaultExecutor(),
) {
  const [existing] = await executor.execute(
    'SELECT phoneme_id, audio_asset_id FROM phonemes WHERE variant_id = ? AND ipa_symbol = ?',
    [variantId, ipaSymbol],
  );
  if (existing.length === 0) {
    return null;
  }

  await executor.execute(
    'UPDATE phonemes SET audio_asset_id = ? WHERE phoneme_id = ?',
    [audioAssetId, existing[0].phoneme_id],
  );
  return existing[0].audio_asset_id;
}

/**
 * Every canonical unit with the audio asset it ACTUALLY serves.
 *
 * The verification path must follow `phonemes.audio_asset_id` rather than
 * rebuild a deterministic key, because since the hybrid audio policy a unit's
 * asset may be Piper-generated or a Commons human recording, and a key derived
 * from an assumed source would report a perfectly good promoted unit as
 * missing.
 *
 * @param {number} variantId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Array<object>>}
 */
export async function listPhonemeAudio(variantId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT p.ipa_symbol, p.frequency_rank, p.audio_asset_id,
            a.asset_key, a.storage_key, a.sha256, a.mime_type, a.byte_length,
            a.generation_status, a.source_kind, a.source_reference, a.author,
            a.licence_identifier, a.licence_url, a.attribution_text
       FROM phonemes p
       LEFT JOIN audio_assets a ON a.audio_asset_id = p.audio_asset_id
      WHERE p.variant_id = ?
      ORDER BY p.frequency_rank`,
    [variantId],
  );

  return rows.map((row) => ({
    ipaSymbol: row.ipa_symbol,
    frequencyRank: row.frequency_rank,
    audioAssetId: row.audio_asset_id,
    assetKey: row.asset_key,
    storageKey: row.storage_key,
    sha256: row.sha256,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    generationStatus: row.generation_status,
    sourceKind: row.source_kind,
    sourceReference: row.source_reference,
    author: row.author,
    licenceIdentifier: row.licence_identifier,
    attributionText: row.attribution_text,
  }));
}
