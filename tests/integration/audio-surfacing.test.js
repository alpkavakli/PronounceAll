/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Audio surfaces on its own when an asset becomes ready (FR-IPA-03/04/07/10,
 * FR-CONTENT-02, SDD §4.12).
 *
 * The render paths are conditional on `generation_status = 'ready'`, gated in
 * `phonemes.repository.js` and `words.repository.js`. That is the claim this
 * suite tests, because the whole audio plan rests on it: generating the assets
 * is expected to light up the popover and the learning page with NO view
 * change. If that were false, it would be discovered only after generation.
 *
 * The suite flips ONE canonical unit to ready against a fixture payload, asserts
 * both directions in the same render — the ready unit shows a control, a unit
 * still pending shows none — and restores the row. The payload is a test
 * fixture; it is not audio, is never committed, and no row is left ready.
 */

import { promises as fs } from 'node:fs';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import * as storage from '../../src/lib/audio-storage.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { markReady } from '../../src/repositories/audio-assets.repository.js';
import { ASSET_KIND, assetKeyFor } from '../../src/services/audio-asset.service.js';

const app = createApp();

/** The unit flipped to ready. `/p/` occurs in `cupcake`, the canonical test word. */
const READY_SYMBOL = 'p';
/** A unit deliberately left pending, to assert the other direction. */
const PENDING_SYMBOL = 'b';

const readyAssetKey = assetKeyFor({
  kind: ASSET_KIND.PHONEME,
  variantCode: 'en-us',
  target: READY_SYMBOL,
  sourceKind: 'tts_piper',
});

let storedKey;

/** @param {string} sql @param {unknown[]} [params] */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/**
 * The IPA symbol a rendered row carries.
 *
 * Anchored past the visually-hidden label, which is the same trap
 * `learn-ipa.test.js` documents: the first `</span>` belongs to that label, not
 * to the symbol.
 *
 * @param {string} row
 * @returns {string|undefined}
 */
function symbolOf(row) {
  const match = row.match(
    /class="phoneme-row__symbol"[^>]*>\s*<span class="visually-hidden">[^<]*<\/span>([^<]*)/,
  );
  return match?.[1].trim();
}

beforeAll(async () => {
  const stored = await storage.store(
    Buffer.from('pronounceall integration fixture; not audio content'),
    'audio/ogg',
  );
  storedKey = stored.storageKey;

  await markReady(readyAssetKey, {
    storageKey: stored.storageKey,
    sha256: stored.sha256,
    mimeType: 'audio/ogg',
    byteLength: stored.byteLength,
  });
});

afterAll(async () => {
  // Restore the row to the true state of the system: pending, with no file.
  await query(
    `UPDATE audio_assets
        SET generation_status = 'pending', storage_key = NULL, sha256 = NULL,
            mime_type = NULL, byte_length = NULL
      WHERE asset_key = ?`,
    [readyAssetKey],
  );
  await closePool();
  await closeRedis();

  if (storedKey) {
    await fs.rm(storage.resolvePath(storedKey), { force: true });
  }
});

describe('the learning page (FR-IPA-07/10)', () => {
  test('a ready unit renders a control and a pending unit renders none', async () => {
    const response = await request(app).get('/en-us/learnIPA');
    expect(response.status).toBe(200);

    const rows = response.text.split('<li').slice(1);
    const readyRow = rows.find((row) => symbolOf(row) === READY_SYMBOL);
    const pendingRow = rows.find((row) => symbolOf(row) === PENDING_SYMBOL);

    expect(readyRow).toBeDefined();
    expect(pendingRow).toBeDefined();
    expect(readyRow).toContain('phoneme-row__audio');
    expect(readyRow).toContain(storedKey);
    expect(pendingRow).not.toContain('phoneme-row__audio');
  });

  test('the control is not autoplayed and does not preload (FR-IPA-06)', async () => {
    const response = await request(app).get('/en-us/learnIPA');

    expect(response.text).toContain('preload="none"');
    expect(response.text).not.toContain('autoplay');
  });
});

describe('the word page popover data (FR-IPA-03/04)', () => {
  test('a ready phoneme carries data-audio, a pending one carries none', async () => {
    const response = await request(app).get('/en-us/cupcake');
    expect(response.status).toBe(200);

    const elements = response.text.split('data-phoneme-id').slice(1);
    const readyElement = elements.find((element) => element.includes(`data-symbol="${READY_SYMBOL}"`));
    expect(readyElement).toBeDefined();
    expect(readyElement).toContain('data-audio=');
    expect(readyElement).toContain(storedKey);

    // /k/ is in `cupcake` too and is still pending, so it must carry no audio.
    const pendingElement = elements.find((element) => element.includes('data-symbol="k"'));
    expect(pendingElement).toBeDefined();
    expect(pendingElement).not.toContain('data-audio=');
  });

  test('the served URL is under the configured public prefix', async () => {
    const response = await request(app).get('/en-us/cupcake');

    expect(response.text).toContain(`data-audio="/audio/${storedKey}"`);
  });
});

describe('no whole-word audio is invented from phoneme audio (SDD §4.12, D-R3-08)', () => {
  test('a ready phoneme asset does not produce a whole-word control', async () => {
    const response = await request(app).get('/en-us/cupcake');

    // `cupcake` has no whole-word asset. A phoneme asset must never be
    // promoted into one.
    expect(response.text).not.toContain('pronunciation__audio');
    expect(response.text).not.toContain('<audio controls');
  });
});
