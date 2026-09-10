/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Iteration 2 seed invariants (FR-IPA-01/02/08, FR-CONTENT-02/04, D4).
 *
 * These assert the properties the seed CLAIMS, against the real database, not
 * the happy path of the pipeline that wrote it. Each one has already failed
 * once in development, which is why it is here:
 *
 *   - the `d` / `ð` audio-asset collision, caused by an accent-insensitive
 *     collation on a column carrying an IPA symbol (fixed by V5);
 *   - `frequency_rank` colliding mid-reseed against ranks still held by other
 *     rows, before the ranking was parked in a disjoint range;
 *   - a canonical form colliding with an existing sibling row, which is a merge
 *     rather than a rewrite.
 */

import { afterAll, describe, expect, test } from '@jest/globals';

import { closePool, getPool } from '../../src/lib/mysql.js';
import { loadInventory, tokenizeTranscription } from '../../src/services/ipa-tokenization.service.js';

const VARIANT_CODE = 'en-us';

/** @param {string} sql @param {unknown[]} [params] */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function variantId() {
  const rows = await query('SELECT variant_id FROM language_variants WHERE code = ?', [VARIANT_CODE]);
  return rows[0].variant_id;
}

afterAll(async () => {
  await closePool();
});

describe('FR-IPA-01 — the canonical inventory is exactly D4', () => {
  test('every D4 unit is present, and nothing else is', async () => {
    const inventory = await loadInventory(VARIANT_CODE);
    const rows = await query(
      'SELECT ipa_symbol FROM phonemes WHERE variant_id = ? ORDER BY frequency_rank',
      [await variantId()],
    );

    const stored = new Set(rows.map((row) => row.ipa_symbol));
    const expected = new Set(inventory.units.map((unit) => unit.ipaSymbol));

    expect([...expected].filter((symbol) => !stored.has(symbol))).toEqual([]);
    expect([...stored].filter((symbol) => !expected.has(symbol))).toEqual([]);
    expect(stored.size).toBe(41);
  });

  test('frequency_rank is dense and unique 1..N', async () => {
    const rows = await query(
      'SELECT frequency_rank FROM phonemes WHERE variant_id = ? ORDER BY frequency_rank',
      [await variantId()],
    );

    expect(rows.map((row) => row.frequency_rank)).toEqual(
      Array.from({ length: rows.length }, (_, index) => index + 1),
    );
  });

  test('more frequent units rank ahead of less frequent ones', async () => {
    // The ranking is derived, so the ordering property is what matters rather
    // than any particular symbol's position.
    const rows = await query(
      `SELECT p.ipa_symbol, p.frequency_rank, COUNT(pp.phoneme_id) AS occurrences
         FROM phonemes p
         LEFT JOIN pronunciation_phonemes pp ON pp.phoneme_id = p.phoneme_id
        WHERE p.variant_id = ?
        GROUP BY p.phoneme_id, p.ipa_symbol, p.frequency_rank
        ORDER BY p.frequency_rank`,
      [await variantId()],
    );

    const occurrences = rows.map((row) => Number(row.occurrences));
    for (let index = 1; index < occurrences.length; index += 1) {
      expect(occurrences[index]).toBeLessThanOrEqual(occurrences[index - 1]);
    }
  });
});

describe('SDD §4.2 — seed invariants the schema alone cannot express', () => {
  test('every phoneme has an audio asset and a primary example word', async () => {
    const rows = await query(
      `SELECT ipa_symbol FROM phonemes
        WHERE variant_id = ? AND (audio_asset_id IS NULL OR primary_example_word_id IS NULL)`,
      [await variantId()],
    );
    expect(rows.map((row) => row.ipa_symbol)).toEqual([]);
  });

  test('no two phonemes share an audio asset', async () => {
    // The `d` / `ð` collision: `utf8mb4_0900_ai_ci` folds `ð` onto `d`, so the
    // deterministic asset key was not unique per unit until V5.
    const shared = await query(
      `SELECT audio_asset_id, GROUP_CONCAT(ipa_symbol) AS symbols
         FROM phonemes WHERE variant_id = ?
        GROUP BY audio_asset_id HAVING COUNT(*) > 1`,
      [await variantId()],
    );
    expect(shared).toEqual([]);
  });

  test('d and ð are distinct rows with distinct audio', async () => {
    const rows = await query(
      "SELECT ipa_symbol, audio_asset_id FROM phonemes WHERE ipa_symbol IN ('d', 'ð') AND variant_id = ?",
      [await variantId()],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].audio_asset_id).not.toBe(rows[1].audio_asset_id);
  });

  test('every example word demonstrates its phoneme (FR-IPA-08, the FIND-01 rule)', async () => {
    const inventory = await loadInventory(VARIANT_CODE);
    const rows = await query(
      `SELECT p.ipa_symbol, e.example_word, e.phonemic_transcription
         FROM phonemes p
         JOIN phoneme_example_words e ON e.example_word_id = p.primary_example_word_id
        WHERE p.variant_id = ?`,
      [await variantId()],
    );

    expect(rows).toHaveLength(41);
    for (const row of rows) {
      const result = tokenizeTranscription(row.phonemic_transcription, inventory);
      expect(result.ok).toBe(true);
      // Anywhere in the transcription, not necessarily word-initially.
      expect(result.forms[0].units).toContain(row.ipa_symbol);
    }
  });
});

describe('D4 §5.7 — every runtime pronunciation tokenises', () => {
  test('no stored pronunciation carries anything the inventory cannot represent', async () => {
    const inventory = await loadInventory(VARIANT_CODE);
    const rows = await query(
      `SELECT w.normalized_headword, p.ipa_transcription
         FROM word_pronunciations p JOIN words w USING (word_id)
        WHERE w.variant_id = ?`,
      [await variantId()],
    );

    const failures = rows
      .map((row) => ({ row, result: tokenizeTranscription(row.ipa_transcription, inventory) }))
      .filter((entry) => !entry.result.ok)
      .map((entry) => `${entry.row.normalized_headword}: /${entry.row.ipa_transcription}/`);

    expect(failures).toEqual([]);
  });

  test('no canonical transcription retains source parenthesis notation', async () => {
    const rows = await query(
      `SELECT p.ipa_transcription FROM word_pronunciations p
         JOIN words w USING (word_id)
        WHERE w.variant_id = ? AND (p.ipa_transcription LIKE '%(%' OR p.ipa_transcription LIKE '%)%')`,
      [await variantId()],
    );
    expect(rows).toEqual([]);
  });

  test('every word still has exactly one primary pronunciation after reconciliation', async () => {
    const rows = await query(
      `SELECT w.normalized_headword, SUM(p.is_primary) AS primaries, COUNT(*) AS total
         FROM words w JOIN word_pronunciations p USING (word_id)
        WHERE w.variant_id = ?
        GROUP BY w.word_id, w.normalized_headword
       HAVING primaries <> 1`,
      [await variantId()],
    );
    expect(rows.map((row) => row.normalized_headword)).toEqual([]);
  });
});

describe('FR-IPA-02 — pronunciation_phonemes reproduces the transcription', () => {
  test('the ordered occurrences match a fresh tokenisation, for every pronunciation', async () => {
    const inventory = await loadInventory(VARIANT_CODE);
    const rows = await query(
      `SELECT p.pronunciation_id, p.ipa_transcription,
              GROUP_CONCAT(ph.ipa_symbol ORDER BY pp.position SEPARATOR ' ') AS units
         FROM word_pronunciations p
         JOIN words w USING (word_id)
         LEFT JOIN pronunciation_phonemes pp ON pp.pronunciation_id = p.pronunciation_id
         LEFT JOIN phonemes ph ON ph.phoneme_id = pp.phoneme_id
        WHERE w.variant_id = ?
        GROUP BY p.pronunciation_id, p.ipa_transcription`,
      [await variantId()],
    );

    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      const expected = tokenizeTranscription(row.ipa_transcription, inventory).forms[0].units;
      expect(row.units ? row.units.split(' ') : []).toEqual(expected);
    }
  });

  test('a diphthong is one occurrence and vowel-plus-R is two', async () => {
    const rows = await query(
      `SELECT w.normalized_headword,
              GROUP_CONCAT(ph.ipa_symbol ORDER BY pp.position SEPARATOR ' ') AS units
         FROM words w
         JOIN word_pronunciations p ON p.word_id = w.word_id AND p.is_primary = 1
         JOIN pronunciation_phonemes pp ON pp.pronunciation_id = p.pronunciation_id
         JOIN phonemes ph ON ph.phoneme_id = pp.phoneme_id
        WHERE w.normalized_headword IN ('cupcake', 'morning')
        GROUP BY w.word_id, w.normalized_headword`,
    );
    const byWord = Object.fromEntries(rows.map((row) => [row.normalized_headword, row.units]));

    // `eɪ` is ONE atomic unit, not `e` + `ɪ`.
    expect(byWord.cupcake).toBe('k ʌ p k eɪ k');
    // `ɔɹ` is TWO compositional units, and the source `oɹ` normalised to `ɔɹ`.
    expect(byWord.morning).toBe('m ɔ ɹ n ɪ ŋ');
  });

  test('positions are dense from zero within each pronunciation', async () => {
    const rows = await query(
      `SELECT pronunciation_id, COUNT(*) AS total, MIN(position) AS lo, MAX(position) AS hi
         FROM pronunciation_phonemes
        GROUP BY pronunciation_id
       HAVING lo <> 0 OR hi <> total - 1`,
    );
    expect(rows).toEqual([]);
  });

  test('no stress mark or syllable separator became an occurrence', async () => {
    const rows = await query(
      "SELECT ipa_symbol FROM phonemes WHERE ipa_symbol IN ('ˈ', 'ˌ', '.')",
    );
    expect(rows).toEqual([]);
  });
});

describe('FR-CONTENT-04 — audio assets carry provenance before they carry files', () => {
  test('every asset records a licence identifier', async () => {
    const rows = await query(
      "SELECT asset_key FROM audio_assets WHERE licence_identifier IS NULL OR licence_identifier = ''",
    );
    expect(rows).toEqual([]);
  });

  test('a pending asset has no file columns filled in', async () => {
    // The seed must not invent a digest or a length to satisfy a constraint.
    const rows = await query(
      `SELECT asset_key FROM audio_assets
        WHERE generation_status = 'pending'
          AND (storage_key IS NOT NULL OR sha256 IS NOT NULL OR byte_length IS NOT NULL)`,
    );
    expect(rows).toEqual([]);
  });

  test('the ready-is-complete constraint rejects a half-populated ready row', async () => {
    await expect(
      query(
        `INSERT INTO audio_assets
           (variant_id, asset_key, generation_status, source_kind, licence_identifier, created_at)
         VALUES (?, 'test:incomplete:ready', 'ready', 'tts_piper', 'CC-BY-SA-4.0', UTC_TIMESTAMP(3))`,
        [await variantId()],
      ),
    ).rejects.toThrow();
  });
});
