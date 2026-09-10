/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The word page through the real stack (FR-WORD-01/02/03/04/08/09, B2, E3).
 *
 * These run against MySQL, because the behaviours under test are the routing,
 * normalisation, and caching decisions the requirements state as HTTP
 * outcomes — a status code, a redirect target, a header — and mocking the
 * repository would test the mock rather than the route.
 *
 * The fixtures are inserted and removed by the suite and use headwords that
 * cannot collide with the seeded dictionary.
 */

// In-memory counters keep the suite independent of Redis and of any other
// process's counts. NFR-SEC-11 permits this outside staging and production; the
// configuration module refuses it there.
process.env.RATE_LIMIT_STORE = 'memory';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { invalidateHeadwordCache } from '../../src/services/word-page.service.js';

const VARIANT_CODE = 'en-us';

/** Fixture headwords, chosen so they cannot collide with the seeded set. */
const FIXTURES = [
  {
    normalized: 'zzfixtureword',
    display: 'zzfixtureword',
    meaning: 'A fixture headword used by the integration suite.',
    pronunciations: [
      { ipa: 'ˈzɪks.tʃɚ', syllables: 'ˈzɪks·tʃɚ', primary: true, order: 0, gloss: null },
      { ipa: 'zɪksˈtʃɚ', syllables: 'zɪks·ˈtʃɚ', primary: false, order: 1, gloss: 'the verb' },
    ],
  },
  {
    normalized: "zzfixture'apostrophe",
    display: "zzfixture'apostrophe",
    meaning: 'A fixture proving the apostrophe survives the allow-list.',
    pronunciations: [
      { ipa: 'ˈzɪks.təˌpɑs', syllables: 'ˈzɪks·tə·ˌpɑs', primary: true, order: 0, gloss: null },
    ],
  },
];

let app;
let variantId;

beforeAll(async () => {
  app = createApp();

  const [variants] = await getPool().execute(
    'SELECT variant_id FROM language_variants WHERE code = ?',
    [VARIANT_CODE],
  );
  variantId = variants[0].variant_id;

  for (const fixture of FIXTURES) {
    const [result] = await getPool().execute(
      `INSERT INTO words (variant_id, normalized_headword, display_headword, meaning,
                          source_url, source_licence, retrieved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE word_id = LAST_INSERT_ID(word_id), meaning = VALUES(meaning)`,
      [
        variantId,
        fixture.normalized,
        fixture.display,
        fixture.meaning,
        `https://en.wiktionary.org/wiki/${encodeURIComponent(fixture.display)}#English`,
        'CC BY-SA 4.0',
        '2026-09-09',
      ],
    );
    fixture.wordId = result.insertId;

    for (const pronunciation of fixture.pronunciations) {
      await getPool().execute(
        `INSERT INTO word_pronunciations (word_id, ipa_transcription, syllable_breakdown,
                                          gloss, is_primary, display_order)
              VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE syllable_breakdown = VALUES(syllable_breakdown)`,
        [
          fixture.wordId,
          pronunciation.ipa,
          pronunciation.syllables,
          pronunciation.gloss,
          pronunciation.primary,
          pronunciation.order,
        ],
      );
    }
  }

  invalidateHeadwordCache(variantId);
});

afterAll(async () => {
  for (const fixture of FIXTURES) {
    if (fixture.wordId) {
      await getPool().execute('DELETE FROM word_pronunciations WHERE word_id = ?', [
        fixture.wordId,
      ]);
      await getPool().execute('DELETE FROM words WHERE word_id = ?', [fixture.wordId]);
    }
  }
  await closePool();
  await closeRedis();
});

describe('FR-WORD-01 — URL pattern and variant routing', () => {
  test('a seeded word returns 200', async () => {
    const response = await request(app).get('/en-us/zzfixtureword');
    expect(response.status).toBe(200);
  });

  test('an unregistered variant 404s and never falls back to en-us', async () => {
    const response = await request(app).get('/fr-fr/zzfixtureword');

    expect(response.status).toBe(404);
    expect(response.text).not.toMatch(/zzfixtureword/);
  });

  test('the variant is validated BEFORE the word lookup', async () => {
    // An unknown word under an unknown variant must report the variant, not
    // offer word suggestions for a variant that does not exist.
    const response = await request(app).get('/fr-fr/cuppcake');

    expect(response.status).toBe(404);
    expect(response.text).toMatch(/language variant is not available/i);
  });

  test('a bare variant with a trailing slash redirects to the home page', async () => {
    const response = await request(app).get('/en-us/');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/');
  });

  test('an unknown single segment is a 404, not a redirect home', async () => {
    expect((await request(app).get('/not-a-variant')).status).toBe(404);
  });
});

describe('FR-WORD-02 — slug normalisation', () => {
  test('mixed case 301-redirects to the canonical URL', async () => {
    const response = await request(app).get('/en-us/ZZFixtureWord');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/en-us/zzfixtureword');
  });

  test('surrounding whitespace 301-redirects to the canonical URL', async () => {
    const response = await request(app).get('/en-us/%20zzfixtureword%20');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/en-us/zzfixtureword');
  });

  test('a null byte in the slug is a 400', async () => {
    expect((await request(app).get('/en-us/zzfixture%00word')).status).toBe(400);
  });

  test('an apostrophe word resolves rather than being rejected', async () => {
    const response = await request(app).get('/en-us/zzfixture%27apostrophe');

    expect(response.status).toBe(200);
    expect(response.text).toContain('zzfixture&#39;apostrophe');
  });

  test('the redirect target is a URL-encoded path', async () => {
    const response = await request(app).get('/en-us/ZZFixture%27Apostrophe');

    expect(response.status).toBe(301);
    // `encodeURIComponent` leaves an apostrophe alone, and a raw `'` is a legal
    // path character, so the canonical target carries it literally. Following
    // the redirect must land on the page itself.
    expect(response.headers.location).toBe("/en-us/zzfixture'apostrophe");
    expect((await request(app).get(response.headers.location)).status).toBe(200);
  });
});

describe('FR-WORD-03 — word page content', () => {
  test('renders the meaning, every transcription, and the syllable breakdown', async () => {
    const { text } = await request(app).get('/en-us/zzfixtureword');

    expect(text).toContain('A fixture headword used by the integration suite.');
    expect(text).toContain('ˈzɪks.tʃɚ');
    expect(text).toContain('ˈzɪks·tʃɚ');
    // Every pronunciation renders, not only the primary — the heteronym case.
    expect(text).toContain('zɪksˈtʃɚ');
    expect(text).toContain('the verb');
  });

  test('the primary pronunciation leads', async () => {
    const { text } = await request(app).get('/en-us/zzfixtureword');

    expect(text.indexOf('ˈzɪks.tʃɚ')).toBeLessThan(text.indexOf('zɪksˈtʃɚ'));
  });

  test('carries the upstream attribution and licence (FR-CONTENT-05, NFR-LEGAL-05)', async () => {
    const { text } = await request(app).get('/en-us/zzfixtureword');

    expect(text).toContain('CC BY-SA 4.0');
    expect(text).toContain('en.wiktionary.org/wiki/');
  });

  test('renders NO audio control in Iteration 1 (Handoff §8.2)', async () => {
    const { text } = await request(app).get('/en-us/zzfixtureword');

    expect(text).not.toMatch(/<audio/i);
    expect(text).not.toMatch(/data-phoneme-id/);
  });
});

describe('FR-WORD-04 / E3 — the fuzzy 404', () => {
  test('a near-miss returns a GENUINE 404, not a 200', async () => {
    // A 200 would let search engines index the page as a real entry.
    expect((await request(app).get('/en-us/zzfixturewrod')).status).toBe(404);
  });

  test('a transposition surfaces the intended word', async () => {
    const { text } = await request(app).get('/en-us/zzfixturewrod');
    expect(text).toContain('zzfixtureword');
  });

  test('a word with no close match shows no suggestions but still offers the form', async () => {
    // FR-WORD-04's acceptance criterion names `xqzzy` for this case, and that
    // example has gone stale: against the ~6 000-word dictionary `xqzzy` is
    // close enough to `sexy` to be offered, which is the matcher working, not
    // failing. The criterion's INTENT — a genuinely unmatchable slug offers
    // nothing — needs a slug that stays unmatchable as the corpus grows.
    // Recorded as FIND-11.
    const { status, text } = await request(app).get('/en-us/qxzjvwkmpf');

    expect(status).toBe(404);
    expect(text).not.toMatch(/Did you mean/);
    expect(text).toMatch(/Request this word/);
  });

  test('the 404 page carries the word-request form (FR-WORD-05)', async () => {
    const { text } = await request(app).get('/en-us/zzfixturemissing');

    expect(text).toMatch(/action="\/request-word"/);
    expect(text).toMatch(/name="variant" value="en-us"/);
    expect(text).toMatch(/name="word" value="zzfixturemissing"/);
  });
});

describe('B2 / §6.3 — the cacheable shell', () => {
  test('the shell is publicly cacheable and carries no per-viewer cookie', async () => {
    const response = await request(app).get('/en-us/zzfixtureword');

    expect(response.headers['cache-control']).toMatch(/public/);
    expect(response.headers['cache-control']).toMatch(/s-maxage=\d+/);
    // A `Set-Cookie` on a shared, edge-cached response would hand one viewer's
    // identity to every later viewer (amended FR-AUTH-01).
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('the shell CSP carries NO nonce (amended NFR-SEC-03)', async () => {
    const { headers } = await request(app).get('/en-us/zzfixtureword');
    const csp = headers['content-security-policy'];

    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).not.toMatch(/nonce-/);
  });

  test('the shell carries no inline script or style, which is what lets it', async () => {
    const { text } = await request(app).get('/en-us/zzfixtureword');

    expect(text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
    expect(text).not.toMatch(/<style[^>]*>/);
    expect(text).not.toMatch(/\sstyle="/);
  });

  test('the 404 page is uncached and DOES take a nonce', async () => {
    const response = await request(app).get('/en-us/zzfixturemissing');

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-security-policy']).toMatch(/nonce-/);
    // This is the path that issues `pa_uid`, since the shell cannot.
    expect(String(response.headers['set-cookie'])).toMatch(/pa_uid=/);
  });
});

describe('FR-WORD-09 — SEO basics', () => {
  test('carries a canonical link and the required title form', async () => {
    const { text } = await request(app).get('/en-us/zzfixtureword');

    expect(text).toMatch(
      /<link rel="canonical" href="[^"]*\/en-us\/zzfixtureword">/,
    );
    expect(text).toMatch(
      /<title>zzfixtureword — American English pronunciation · PronounceAll<\/title>/,
    );
  });

  test('carries a meta description of at most 160 characters', async () => {
    const { text } = await request(app).get('/en-us/zzfixtureword');
    const match = text.match(/<meta name="description" content="([^"]*)">/);

    expect(match).not.toBeNull();
    expect(match[1].length).toBeLessThanOrEqual(160);
  });
});
