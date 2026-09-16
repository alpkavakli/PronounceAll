/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Per-pronunciation provenance (SDD §4.2, FR-CONTENT-05, V7 migration).
 *
 * A pronunciation from a source other than the word's Wiktionary entry names
 * that source on the row and on the page. The database refuses such a row
 * without attribution, and an ordinary Wiktionary pronunciation gets no
 * redundant label.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { invalidateHeadwordCache } from '../../src/services/word-page.service.js';

const REFERENCE =
  'https://github.com/cmusphinx/cmudict/blob/74790861f652b15e4ac49015a90074ad62a27690/cmudict.dict#L1';

let app;
let variantId;
let wordId;

beforeAll(async () => {
  app = createApp();
  const [variants] = await getPool().execute('SELECT variant_id FROM language_variants WHERE code = ?', [
    'en-us',
  ]);
  variantId = variants[0].variant_id;

  const [word] = await getPool().execute(
    `INSERT INTO words (variant_id, normalized_headword, display_headword, meaning,
                        source_url, source_licence, retrieved_at)
          VALUES (?, 'zzprovenance', 'zzprovenance', 'A provenance fixture.',
                  'https://en.wiktionary.org/wiki/zzprovenance#English', 'CC BY-SA 4.0', '2026-09-16')
     ON DUPLICATE KEY UPDATE word_id = LAST_INSERT_ID(word_id)`,
    [variantId],
  );
  wordId = word.insertId;

  await getPool().execute(
    `INSERT INTO word_pronunciations (word_id, ipa_transcription, syllable_breakdown, gloss, is_primary,
                                      display_order, source_kind, source_reference, licence_identifier)
          VALUES (?, ?, ?, NULL, TRUE, 0, 'cmudict', ?, 'LicenseRef-CMUdict'),
                 (?, ?, ?, NULL, FALSE, 1, DEFAULT, NULL, NULL)`,
    [wordId, 'ˈzoʊvən', 'ˈzoʊ·vən', REFERENCE, wordId, 'ˈzɑvən', 'ˈzɑ·vən'],
  );
  invalidateHeadwordCache(variantId);
});

afterAll(async () => {
  await getPool().execute('DELETE FROM word_pronunciations WHERE word_id = ?', [wordId]);
  await getPool().execute('DELETE FROM words WHERE word_id = ?', [wordId]);
  await closePool();
  await closeRedis();
});

describe('per-pronunciation provenance', () => {
  test('an ordinary row defaults to Wiktionary with no duplicate metadata', async () => {
    const [rows] = await getPool().execute(
      `SELECT source_kind, source_reference, licence_identifier
         FROM word_pronunciations WHERE word_id = ? AND ipa_transcription = ?`,
      [wordId, 'ˈzɑvən'],
    );
    expect(rows[0]).toEqual({ source_kind: 'wiktionary', source_reference: null, licence_identifier: null });
  });

  test('the database refuses a non-Wiktionary row without attribution', async () => {
    await expect(
      getPool().execute(
        `INSERT INTO word_pronunciations (word_id, ipa_transcription, syllable_breakdown, is_primary,
                                          display_order, source_kind)
              VALUES (?, ?, ?, FALSE, 2, 'cmudict')`,
        [wordId, 'ˈzivən', 'ˈzi·vən'],
      ),
    ).rejects.toThrow(/ck_word_pronunciations_source_attributed/);
  });

  test('the page names CMUdict beside that pronunciation only', async () => {
    const response = await request(app).get('/en-us/zzprovenance');
    expect(response.status).toBe(200);
    expect(response.text.match(/class="pronunciation__source"/g) ?? []).toHaveLength(1);
    expect(response.text).toContain(`href="${REFERENCE}"`);
    expect(response.text).toContain('CMU Pronouncing Dictionary');
  });
});
