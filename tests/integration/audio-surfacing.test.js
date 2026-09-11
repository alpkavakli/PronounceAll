/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Audio surfaces on its own with the asset's state (FR-IPA-03/04/07/10,
 * FR-CONTENT-02, SDD §4.12).
 *
 * The render paths are conditional on `generation_status = 'ready'`, gated in
 * `phonemes.repository.js` and `words.repository.js`. That is the claim this
 * suite tests, because the audio plan rested on it: generating the assets was
 * expected to light up the popover and the learning page with NO view change.
 *
 * The suite asserts BOTH directions in one render: a ready unit shows a control
 * and a unit whose asset is not ready shows none. To do that it forces one
 * canonical unit to `pending` for the duration of the run.
 *
 * It must work both before and after the Piper batch has run, so it SNAPSHOTS
 * every row it touches and restores it verbatim afterwards rather than assuming
 * a starting state. Assuming `pending` would have destroyed real generated
 * assets once the batch existed.
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

/** Ready for the whole run. `/p/` occurs in `cupcake`, the canonical test word. */
const READY_SYMBOL = 'p';
/** Forced to `pending` for the whole run, and restored. `/k/` also occurs in `cupcake`. */
const PENDING_SYMBOL = 'k';

/** @param {string} symbol */
function keyFor(symbol) {
  return assetKeyFor({
    kind: ASSET_KIND.PHONEME,
    variantCode: 'en-us',
    target: symbol,
    sourceKind: 'tts_piper',
  });
}

/** Rows as they were before this suite touched them, restored in afterAll. */
const snapshots = new Map();
/** A fixture file this suite created, removed in afterAll. Null when none was needed. */
let fixtureStorageKey = null;
/** The storage key the ready unit actually serves, generated or fixture. */
let readyStorageKey;

/** @param {string} sql @param {unknown[]} [params] */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/** @param {string} assetKey */
async function snapshot(assetKey) {
  const rows = await query(
    `SELECT storage_key, sha256, mime_type, byte_length, generation_status
       FROM audio_assets WHERE asset_key = ?`,
    [assetKey],
  );
  snapshots.set(assetKey, rows[0]);
  return rows[0];
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
  const readyKey = keyFor(READY_SYMBOL);
  const pendingKey = keyFor(PENDING_SYMBOL);

  const existingReady = await snapshot(readyKey);
  await snapshot(pendingKey);

  if (existingReady?.generation_status === 'ready') {
    // The batch has run: use the real asset rather than overwriting it.
    readyStorageKey = existingReady.storage_key;
  } else {
    // No audio generated yet: stand one up from a fixture payload. It is not
    // audio content and is removed again in afterAll.
    const stored = await storage.store(
      Buffer.from('pronounceall integration fixture; not audio content'),
      'audio/ogg',
    );
    fixtureStorageKey = stored.storageKey;
    readyStorageKey = stored.storageKey;
    await markReady(readyKey, {
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      mimeType: 'audio/ogg',
      byteLength: stored.byteLength,
    });
  }

  // Force the negative case, whatever its real state is.
  await query(
    `UPDATE audio_assets
        SET generation_status = 'pending', storage_key = NULL, sha256 = NULL,
            mime_type = NULL, byte_length = NULL
      WHERE asset_key = ?`,
    [pendingKey],
  );
});

afterAll(async () => {
  // Restore every touched row verbatim, so a generated asset survives the run.
  for (const [assetKey, row] of snapshots) {
    if (!row) {
      continue;
    }
    await query(
      `UPDATE audio_assets
          SET generation_status = ?, storage_key = ?, sha256 = ?, mime_type = ?, byte_length = ?
        WHERE asset_key = ?`,
      [row.generation_status, row.storage_key, row.sha256, row.mime_type, row.byte_length, assetKey],
    );
  }

  await closePool();
  await closeRedis();

  if (fixtureStorageKey) {
    await fs.rm(storage.resolvePath(fixtureStorageKey), { force: true });
  }
});

describe('the learning page (FR-IPA-07/10)', () => {
  test('a ready unit renders a control and a not-ready unit renders none', async () => {
    const response = await request(app).get('/en-us/learnIPA');
    expect(response.status).toBe(200);

    const rows = response.text.split('<li').slice(1);
    const readyRow = rows.find((row) => symbolOf(row) === READY_SYMBOL);
    const pendingRow = rows.find((row) => symbolOf(row) === PENDING_SYMBOL);

    expect(readyRow).toBeDefined();
    expect(pendingRow).toBeDefined();
    expect(readyRow).toContain('phoneme-row__audio');
    expect(readyRow).toContain(readyStorageKey);
    expect(pendingRow).not.toContain('phoneme-row__audio');
  });

  test('the control is not autoplayed and does not preload (FR-IPA-06)', async () => {
    const response = await request(app).get('/en-us/learnIPA');

    expect(response.text).toContain('preload="none"');
    expect(response.text).not.toContain('autoplay');
  });
});

describe('the word page popover data (FR-IPA-03/04)', () => {
  test('a ready phoneme carries data-audio, a not-ready one carries none', async () => {
    const response = await request(app).get('/en-us/cupcake');
    expect(response.status).toBe(200);

    const elements = response.text.split('data-phoneme-id').slice(1);
    const readyElement = elements.find((element) => element.includes(`data-symbol="${READY_SYMBOL}"`));
    expect(readyElement).toBeDefined();
    expect(readyElement).toContain('data-audio=');
    expect(readyElement).toContain(readyStorageKey);

    const pendingElement = elements.find((element) => element.includes(`data-symbol="${PENDING_SYMBOL}"`));
    expect(pendingElement).toBeDefined();
    expect(pendingElement).not.toContain('data-audio=');
  });

  test('the served URL is under the configured public prefix', async () => {
    const response = await request(app).get('/en-us/cupcake');

    expect(response.text).toContain(`data-audio="/audio/${readyStorageKey}"`);
  });
});

describe('no whole-word audio is invented from phoneme audio (SDD §4.12, D-R3-08)', () => {
  test('ready phoneme assets do not produce a whole-word control', async () => {
    const response = await request(app).get('/en-us/cupcake');

    // `cupcake` has no whole-word asset. A phoneme asset must never be
    // promoted into one.
    expect(response.text).not.toContain('pronunciation__audio');
    expect(response.text).not.toContain('<audio controls');
  });
});
