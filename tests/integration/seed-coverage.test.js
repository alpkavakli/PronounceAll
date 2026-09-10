/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Dictionary coverage (FR-WORD-10, FR-CONTENT-01, D4 §5.7).
 *
 * The tripwire this suite exists for: the 123-word development sample looked
 * perfectly reasonable and was missing `happy`, `good`, `house`, `think` and
 * thirty other words an ordinary person would type first. A seed can be large
 * and still quietly useless, so size alone is not asserted — the representative
 * vocabulary is.
 */

import { afterAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { SMOKE_VOCABULARY } from '../../scripts/seed-headwords.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { loadInventory, tokenizeTranscription } from '../../src/services/ipa-tokenization.service.js';

const app = createApp();
const VARIANT = 'en-us';

/** FR-WORD-10's launch floor. */
const REQUIRED_HEADWORDS = 5000;

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function variantId() {
  const rows = await query('SELECT variant_id FROM language_variants WHERE code = ?', [VARIANT]);
  return rows[0].variant_id;
}

afterAll(async () => {
  await closePool();
  await closeRedis();
});

describe('FR-WORD-10 — seeded dictionary coverage', () => {
  test(`holds at least ${REQUIRED_HEADWORDS} headwords`, async () => {
    const rows = await query('SELECT COUNT(*) AS total FROM words WHERE variant_id = ?', [
      await variantId(),
    ]);
    expect(Number(rows[0].total)).toBeGreaterThanOrEqual(REQUIRED_HEADWORDS);
  });

  test('every word has a meaning, a pronunciation, and attribution', async () => {
    const rows = await query(
      `SELECT w.normalized_headword
         FROM words w
         LEFT JOIN word_pronunciations p ON p.word_id = w.word_id
        WHERE w.variant_id = ?
        GROUP BY w.word_id, w.normalized_headword, w.meaning, w.source_url, w.source_licence, w.retrieved_at
       HAVING COUNT(p.pronunciation_id) = 0
           OR w.meaning IS NULL OR w.meaning = ''
           OR w.source_url = '' OR w.source_licence = '' OR w.retrieved_at IS NULL
        LIMIT 20`,
      [await variantId()],
    );
    expect(rows.map((row) => row.normalized_headword)).toEqual([]);
  });

  test('every word has exactly one primary pronunciation', async () => {
    const rows = await query(
      `SELECT w.normalized_headword
         FROM words w JOIN word_pronunciations p ON p.word_id = w.word_id
        WHERE w.variant_id = ?
        GROUP BY w.word_id, w.normalized_headword
       HAVING SUM(p.is_primary) <> 1
        LIMIT 20`,
      [await variantId()],
    );
    expect(rows.map((row) => row.normalized_headword)).toEqual([]);
  });
});

describe('the representative vocabulary a learner would type first', () => {
  const words = SMOKE_VOCABULARY[VARIANT];

  test('the list is a real tripwire, not an empty one', () => {
    expect(words.length).toBeGreaterThanOrEqual(40);
  });

  test('every word is in the dictionary', async () => {
    const rows = await query('SELECT normalized_headword FROM words WHERE variant_id = ?', [
      await variantId(),
    ]);
    const present = new Set(rows.map((row) => row.normalized_headword));

    // Reported as a list rather than one failure at a time, so a regression
    // shows its whole shape in one run.
    expect(words.filter((word) => !present.has(word))).toEqual([]);
  });

  test.each(['beautiful', 'gorgeous', 'happy', 'good', 'house', 'think', 'go'])(
    '/en-us/%s renders a real page',
    async (word) => {
      const response = await request(app).get(`/en-us/${word}`);

      expect(response.status).toBe(200);
      expect(response.text).toContain('class="ipa"');
      expect(response.text).toMatch(/class="meaning__text"/);
    },
  );

  test('each one is reachable through search', async () => {
    for (const word of ['beautiful', 'gorgeous', 'happy', 'university']) {
      const response = await request(app).get('/search').query({ q: word });
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(`/en-us/${word}`);
    }
  });
});

describe('D4 §5.7 — the whole corpus tokenises', () => {
  test('100 % of runtime pronunciations tokenise into canonical units', async () => {
    const inventory = await loadInventory(VARIANT);
    const rows = await query(
      `SELECT w.normalized_headword, p.ipa_transcription
         FROM word_pronunciations p JOIN words w USING (word_id)
        WHERE w.variant_id = ?`,
      [await variantId()],
    );

    expect(rows.length).toBeGreaterThan(5000);

    const failures = rows
      .filter((row) => !tokenizeTranscription(row.ipa_transcription, inventory).ok)
      .map((row) => `${row.normalized_headword}: /${row.ipa_transcription}/`)
      .slice(0, 20);

    expect(failures).toEqual([]);
  });

  test('every pronunciation has its ordered occurrences', async () => {
    const rows = await query(
      `SELECT COUNT(*) AS total
         FROM word_pronunciations p
         JOIN words w USING (word_id)
        WHERE w.variant_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM pronunciation_phonemes pp
             WHERE pp.pronunciation_id = p.pronunciation_id
          )`,
      [await variantId()],
    );
    expect(Number(rows[0].total)).toBe(0);
  });

  test('no source notation survived into a canonical transcription', async () => {
    const rows = await query(
      `SELECT ipa_transcription FROM word_pronunciations p JOIN words w USING (word_id)
        WHERE w.variant_id = ?
          AND (ipa_transcription LIKE '%(%'
            OR ipa_transcription LIKE '%)%'
            OR ipa_transcription LIKE '%ː%'
            OR ipa_transcription LIKE '%r%')
        LIMIT 10`,
      [await variantId()],
    );
    expect(rows.map((row) => row.ipa_transcription)).toEqual([]);
  });
});

describe('FR-IPA-01 — the phoneme ranking reflects the real corpus', () => {
  test('ranks are dense and unique over 41 units', async () => {
    const rows = await query(
      'SELECT frequency_rank FROM phonemes WHERE variant_id = ? ORDER BY frequency_rank',
      [await variantId()],
    );
    expect(rows.map((row) => row.frequency_rank)).toEqual(
      Array.from({ length: 41 }, (_, index) => index + 1),
    );
  });

  test('every canonical unit now occurs in the corpus', async () => {
    // The 123-word sample never used /ɔɪ/. A dictionary of several thousand
    // words should exercise the whole inventory, which is what makes the
    // derived ranking meaningful rather than provisional.
    const rows = await query(
      `SELECT p.ipa_symbol
         FROM phonemes p
        WHERE p.variant_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM pronunciation_phonemes pp WHERE pp.phoneme_id = p.phoneme_id
          )`,
      [await variantId()],
    );
    expect(rows.map((row) => row.ipa_symbol)).toEqual([]);
  });
});
