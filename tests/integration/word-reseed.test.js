/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * A word re-seed drops a stale pronunciation (E1, E4, SDD §4.9).
 *
 * Once `seed:phonemes` has run, every pronunciation is referenced by
 * `pronunciation_phonemes` through a RESTRICT foreign key. A re-seed that no
 * longer selects a transcription — a curation pin removing a British form, say —
 * must remove the row AND its occurrences in the same transaction, while the
 * surviving row keeps its identity.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { loadEntry } from '../../src/services/word-ingestion.service.js';

const HEADWORD = 'zzreseedfixture';

const entry = (pronunciations) => ({
  normalizedHeadword: HEADWORD,
  displayHeadword: HEADWORD,
  meaning: 'A fixture for the re-seed removal path.',
  sourceUrl: 'https://en.wiktionary.org/wiki/zzreseedfixture',
  sourceLicence: 'CC BY-SA 4.0',
  retrievedAt: '2026-09-16',
  pronunciations: pronunciations.map((ipaTranscription, index) => ({
    ipaTranscription,
    syllableBreakdown: ipaTranscription,
    gloss: null,
    isPrimary: index === 0,
    displayOrder: index,
  })),
});

let variantId;
let wordId;

const rowsFor = async () => {
  const [rows] = await getPool().execute(
    'SELECT pronunciation_id, ipa_transcription FROM word_pronunciations WHERE word_id = ? ORDER BY display_order',
    [wordId],
  );
  return rows;
};

beforeAll(async () => {
  const [variants] = await getPool().execute('SELECT variant_id FROM language_variants WHERE code = ?', [
    'en-us',
  ]);
  variantId = variants[0].variant_id;
});

afterAll(async () => {
  if (wordId) {
    await getPool().execute(
      `DELETE pp FROM pronunciation_phonemes pp
         JOIN word_pronunciations p ON p.pronunciation_id = pp.pronunciation_id
        WHERE p.word_id = ?`,
      [wordId],
    );
    await getPool().execute('DELETE FROM word_pronunciations WHERE word_id = ?', [wordId]);
    await getPool().execute('DELETE FROM words WHERE word_id = ?', [wordId]);
  }
  await closePool();
  await closeRedis();
});

describe('re-seeding a word that no longer lists a transcription', () => {
  test('removes the stale row and its occurrences, and keeps the survivor', async () => {
    ({ wordId } = await loadEntry(entry(['ˈbʌt', 'ˈbɔt']), variantId));
    const [kept, stale] = await rowsFor();

    const [[phoneme]] = await getPool().execute("SELECT phoneme_id FROM phonemes WHERE ipa_symbol = 'b' LIMIT 1");
    for (const row of [kept, stale]) {
      await getPool().execute(
        'INSERT INTO pronunciation_phonemes (pronunciation_id, position, phoneme_id) VALUES (?, 0, ?)',
        [row.pronunciation_id, phoneme.phoneme_id],
      );
    }

    const result = await loadEntry(entry(['ˈbʌt']), variantId);

    expect(result.removed).toBe(1);
    expect(await rowsFor()).toEqual([kept]);
    const [occurrences] = await getPool().execute(
      'SELECT COUNT(*) AS n FROM pronunciation_phonemes WHERE pronunciation_id = ?',
      [stale.pronunciation_id],
    );
    expect(Number(occurrences[0].n)).toBe(0);
  });
});
