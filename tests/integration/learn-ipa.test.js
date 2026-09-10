/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The phoneme learning pages (FR-IPA-07, FR-IPA-08, FR-IPA-10, SDD §6.3).
 *
 * The assertion that earns its place here is the ROUTING ORDER one.
 * `/:variant/learnIPA` is indistinguishable from `GET /:variant/:word`, so the
 * learning page works only while its router is registered first. That is a
 * silent, total break waiting for someone to tidy the composition root, and
 * nothing else in the suite would catch it.
 */

import { afterAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';

const app = createApp();

afterAll(async () => {
  await closePool();
  await closeRedis();
});

/**
 * The IPA symbols, in render order.
 *
 * Anchored past the visually-hidden label rather than lazily to the first
 * `</span>`, which is that label's own closing tag and not the symbol's.
 *
 * @param {string} html
 * @returns {string[]}
 */
function symbolsFrom(html) {
  return [
    ...html.matchAll(
      /class="phoneme-row__symbol"[^>]*>\s*<span class="visually-hidden">[^<]*<\/span>([^<]*)/g,
    ),
  ].map((match) => match[1].trim());
}

describe('the route survives the word route (the ordering trap)', () => {
  test('/en-us/learnIPA is the learning page, not a word lookup', async () => {
    const response = await request(app).get('/en-us/learnIPA');

    expect(response.status).toBe(200);
    // A word lookup would 404 with the fuzzy-suggestion page instead.
    expect(response.text).toContain('phoneme-row');
    expect(response.text).not.toContain('not in the dictionary yet');
  });

  test('an ordinary word is still a word', async () => {
    const response = await request(app).get('/en-us/cupcake');

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('phoneme-row__rank');
  });
});

describe('FR-IPA-07 — the per-variant inventory', () => {
  test('lists every phoneme for the variant', async () => {
    const [rows] = await getPool().query(
      `SELECT COUNT(*) AS total FROM phonemes p
         JOIN language_variants v ON v.variant_id = p.variant_id
        WHERE v.code = 'en-us'`,
    );
    const response = await request(app).get('/en-us/learnIPA');

    expect(symbolsFrom(response.text)).toHaveLength(Number(rows[0].total));
  });

  test('rows are ordered by ascending frequency rank — the acceptance criterion', async () => {
    const [rows] = await getPool().query(
      `SELECT p.ipa_symbol FROM phonemes p
         JOIN language_variants v ON v.variant_id = p.variant_id
        WHERE v.code = 'en-us'
        ORDER BY p.frequency_rank ASC`,
    );
    const response = await request(app).get('/en-us/learnIPA');

    expect(symbolsFrom(response.text)).toEqual(rows.map((row) => row.ipa_symbol));
  });

  test('every row shows its FR-IPA-08 sound-matched example word', async () => {
    const [rows] = await getPool().query(
      `SELECT e.example_word FROM phonemes p
         JOIN phoneme_example_words e ON e.example_word_id = p.primary_example_word_id
         JOIN language_variants v ON v.variant_id = p.variant_id
        WHERE v.code = 'en-us' AND e.match_mode = 'sound'`,
    );
    const response = await request(app).get('/en-us/learnIPA');

    expect(rows.length).toBe(41);
    for (const row of rows) {
      expect(response.text).toContain(`<strong>${row.example_word}</strong>`);
    }
  });

  test('an unsupported variant is a 404', async () => {
    expect((await request(app).get('/fr-fr/learnIPA')).status).toBe(404);
  });

  test('no variant marker, because every row would carry the same one', async () => {
    const response = await request(app).get('/en-us/learnIPA');
    expect(response.text).not.toContain('phoneme-row__variant');
  });
});

describe('FR-IPA-10 — the cross-variant index', () => {
  test('returns the same rows as the per-variant page while en-us is the only variant', async () => {
    const [global, perVariant] = await Promise.all([
      request(app).get('/learnIPA'),
      request(app).get('/en-us/learnIPA'),
    ]);

    expect(global.status).toBe(200);
    expect(symbolsFrom(global.text)).toEqual(symbolsFrom(perVariant.text));
  });

  test('marks the variant each phoneme belongs to', async () => {
    const response = await request(app).get('/learnIPA');
    expect(response.text).toContain('phoneme-row__variant');
    expect(response.text).toContain('en-us');
  });

  test('is reachable from the site footer, and not from a word page body', async () => {
    const word = await request(app).get('/en-us/cupcake');

    // FR-IPA-10 places it in the footer deliberately: in v1.0 an in-page link
    // would lead somewhere identical to the per-variant page.
    expect(word.text).toContain('href="/learnIPA"');
    expect(word.text.indexOf('href="/learnIPA"')).toBeGreaterThan(
      word.text.indexOf('site-footer'),
    );
  });

  test('the per-variant page does not link to it either', async () => {
    const response = await request(app).get('/en-us/learnIPA');
    const body = response.text.slice(0, response.text.indexOf('site-footer'));

    expect(body).not.toContain('href="/learnIPA"');
  });
});

describe('URL canonicalisation', () => {
  test.each([
    ['/en-us/learnipa', '/en-us/learnIPA'],
    ['/en-us/LearnIpa', '/en-us/learnIPA'],
    ['/LEARNIPA', '/learnIPA'],
  ])('%s redirects to %s', async (from, to) => {
    // Express matches case-insensitively, so without this the page would serve
    // under several URLs at once — the duplicate-content problem FR-WORD-02
    // exists to prevent.
    const response = await request(app).get(from);

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe(to);
  });

  test('an unsupported variant 404s rather than redirecting somewhere useless', async () => {
    expect((await request(app).get('/fr-fr/learnipa')).status).toBe(404);
  });
});

describe('SDD §6.3 — the learning pages are not cacheable', () => {
  test.each(['/learnIPA', '/en-us/learnIPA'])('%s is private and uncached', async (url) => {
    const response = await request(app).get(url);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  test('carries no inline script or style', async () => {
    const response = await request(app).get('/en-us/learnIPA');

    expect(response.text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
    expect(response.text).not.toMatch(/<style[^>]*>/);
  });
});

describe('controls that cannot work are absent', () => {
  test('no audio element while every phoneme asset is pending', async () => {
    const response = await request(app).get('/en-us/learnIPA');
    expect(response.text).not.toContain('<audio');
  });

  test('no save control — that is Iteration 3', async () => {
    const response = await request(app).get('/en-us/learnIPA');
    expect(response.text).not.toMatch(/name="state"|class="save/);
  });
});
