/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The FR-IPA-05 fallback chain and the FR-IPA-06 preload strategy, as the
 * server renders them (also SDD §4.12 / D-R3-08).
 *
 * Tiers 1 and 2 are resolved server-side and produce a native `<audio controls>`
 * element, which doubles as the FR-WORD-08 no-JavaScript path. Tier 3 is the
 * visitor's own Web Speech API and can only be offered as a button the client
 * script unhides; what is testable here is that the button is emitted exactly
 * where the chain has run out, and only for the primary pronunciation.
 *
 * The suite snapshots and restores any row it changes, so it is correct both
 * before and after the word TTS batch has run.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';

const app = createApp();

const WORD = 'cupcake';

/** Rows as they were before this suite touched them. */
let primaryRow;

/** @param {string} sql @param {unknown[]} [params] */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function primaryPronunciation() {
  const rows = await query(
    `SELECT p.pronunciation_id, p.whole_word_audio_asset_id
       FROM word_pronunciations p
       JOIN words w ON w.word_id = p.word_id
       JOIN language_variants v ON v.variant_id = w.variant_id
      WHERE v.code = 'en-us' AND w.normalized_headword = ? AND p.is_primary = 1`,
    [WORD],
  );
  return rows[0];
}

beforeAll(async () => {
  primaryRow = await primaryPronunciation();
});

afterAll(async () => {
  if (primaryRow) {
    await query('UPDATE word_pronunciations SET whole_word_audio_asset_id = ? WHERE pronunciation_id = ?', [
      primaryRow.whole_word_audio_asset_id,
      primaryRow.pronunciation_id,
    ]);
  }
  await closePool();
  await closeRedis();
});

/** Detach the primary pronunciation's asset, simulating a word the batch could not cover. */
async function withoutWholeWordAudio() {
  await query('UPDATE word_pronunciations SET whole_word_audio_asset_id = NULL WHERE pronunciation_id = ?', [
    primaryRow.pronunciation_id,
  ]);
}

/** Restore whatever the row had. */
async function restoreWholeWordAudio() {
  await query('UPDATE word_pronunciations SET whole_word_audio_asset_id = ? WHERE pronunciation_id = ?', [
    primaryRow.whole_word_audio_asset_id,
    primaryRow.pronunciation_id,
  ]);
}

describe('FR-IPA-05 — tiers 1 and 2 render a native control', () => {
  test('a pronunciation with a ready asset gets a no-JavaScript <audio> element', async () => {
    await restoreWholeWordAudio();
    const response = await request(app).get(`/en-us/${WORD}`);

    if (primaryRow.whole_word_audio_asset_id === null) {
      // The word batch has not run for this word; nothing to assert here.
      return;
    }

    expect(response.text).toContain('<audio controls');
    expect(response.text).toContain('preload="none"');
    // The native element needs no script at all, which is what makes it the
    // FR-WORD-08 fallback.
    expect(response.text).not.toContain('autoplay');
  });
});

describe('FR-IPA-05 tier 3 — Web Speech is offered only where the chain runs out', () => {
  test('no server-side asset yields a speak button on the primary pronunciation', async () => {
    await withoutWholeWordAudio();
    try {
      const response = await request(app).get(`/en-us/${WORD}`);

      expect(response.text).toContain('pronunciation__speak');
      expect(response.text).toContain(`data-speak="${WORD}"`);
      // Hidden until the client confirms speechSynthesis exists, so a browser
      // that cannot speak is never shown a control that does nothing.
      expect(response.text).toMatch(/class="pronunciation__speak" hidden/);
      // FR-IPA-05 forbids a silent failure, so the live region is present.
      expect(response.text).toContain('pronunciation__audio-status');
    } finally {
      await restoreWholeWordAudio();
    }
  });

  test('a ready asset means no speak button — the chain stopped at tier 2', async () => {
    await restoreWholeWordAudio();
    if (primaryRow.whole_word_audio_asset_id === null) {
      return;
    }

    const response = await request(app).get(`/en-us/${WORD}`);

    expect(response.text).not.toContain('pronunciation__speak');
  });

  test('a secondary pronunciation is never offered Web Speech (D-R3-08)', async () => {
    await withoutWholeWordAudio();
    try {
      const response = await request(app).get(`/en-us/${WORD}`);
      const speakButtons = response.text.match(/pronunciation__speak/g)?.length ?? 0;

      // At most one, and only on the primary row: synthesised speech must never
      // stand in for a specific secondary reading.
      expect(speakButtons).toBeLessThanOrEqual(1);
    } finally {
      await restoreWholeWordAudio();
    }
  });
});

describe('FR-IPA-06 — preload on word pages, lazy-load on the learning pages', () => {
  test('the word page preloads each distinct ready phoneme asset it uses', async () => {
    const rows = await query(
      `SELECT COUNT(DISTINCT a.storage_key) AS distinctReady
         FROM word_pronunciations p
         JOIN words w ON w.word_id = p.word_id
         JOIN language_variants v ON v.variant_id = w.variant_id
         JOIN pronunciation_phonemes pp ON pp.pronunciation_id = p.pronunciation_id
         JOIN phonemes ph ON ph.phoneme_id = pp.phoneme_id
         JOIN audio_assets a ON a.audio_asset_id = ph.audio_asset_id
        WHERE v.code = 'en-us' AND w.normalized_headword = ?
          AND a.generation_status = 'ready'`,
      [WORD],
    );

    const response = await request(app).get(`/en-us/${WORD}`);
    const links = response.text.match(/<link rel="preload" as="audio"/g)?.length ?? 0;

    expect(links).toBe(Number(rows[0].distinctReady));
    expect(links).toBeGreaterThan(0);
  });

  test('a repeated phoneme is preloaded once', async () => {
    // `cupcake` is /k/ ʌ p k eɪ k/ — three /k/ occurrences, one link.
    const response = await request(app).get(`/en-us/${WORD}`);
    const hrefs = [...response.text.matchAll(/<link rel="preload" as="audio" href="([^"]+)"/g)].map((m) => m[1]);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test('the per-variant learning page preloads no audio', async () => {
    const response = await request(app).get('/en-us/learnIPA');

    expect(response.text).not.toContain('rel="preload" as="audio"');
  });

  test('the global learning page preloads no audio (FR-IPA-10)', async () => {
    const response = await request(app).get('/learnIPA');

    expect(response.text).not.toContain('rel="preload" as="audio"');
  });
});
