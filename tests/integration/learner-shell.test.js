/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The viewer-neutral half of learner state (FR-WORD-06, FR-IPA-02, FR-IPA-07;
 * B2).
 *
 * The shell carries the zero-learned invitation with N from `phonemes`, a
 * default accessible name on every phoneme, and a hidden progress placeholder.
 * Nothing in it may assert a viewer's learned state.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';

let app;
let total;

beforeAll(async () => {
  app = createApp();
  const [[row]] = await getPool().execute(
    "SELECT COUNT(*) AS n FROM phonemes p JOIN language_variants v ON v.variant_id = p.variant_id WHERE v.code = 'en-us'",
  );
  total = Number(row.n);
});

afterAll(async () => {
  await closePool();
  await closeRedis();
});

describe('word page shell', () => {
  test('carries the FR-WORD-06 invitation with N from the phonemes table, linking to learnIPA', async () => {
    const response = await request(app).get('/en-us/cupcake');
    expect(response.text).toContain(`data-ipa-banner data-total="${total}"`);
    expect(response.text).toContain(
      `href="/en-us/learnIPA">Learn every sound in English! Just learn these ${total} IPA symbols to pronounce every word</a>`,
    );
  });

  test('gives every phoneme the default accessible name and no learner state', async () => {
    const response = await request(app).get('/en-us/cupcake');
    const phonemes = response.text.match(/class="phoneme"/g) ?? [];
    const labels = response.text.match(/aria-label="phoneme \/[^/"]+\/"/g) ?? [];
    expect(phonemes.length).toBeGreaterThan(0);
    expect(labels).toHaveLength(phonemes.length);
    expect(response.text).not.toMatch(/phoneme--learned|phoneme--not-learned|not learned yet|doing great/);
  });
});

describe('learnIPA', () => {
  test('carries a hidden progress placeholder and a learner hook on every row', async () => {
    const response = await request(app).get('/en-us/learnIPA');
    expect(response.text).toContain(`data-learn-progress data-total="${total}" hidden`);
    expect((response.text.match(/data-learner-phoneme="\d+"/g) ?? []).length).toBe(total);
  });
});
