/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Promoting a reviewed replacement into production (audio source policy v1.1;
 * FR-CONTENT-02/04/05, V4, D4).
 *
 * Promotion is the only step that changes what a learner hears, so what matters
 * is that it moves a pointer and destroys nothing: the superseded asset must
 * survive, in the database and on disk, or a rejected replacement could not be
 * reversed. These assert that, plus the provenance guards that stop an
 * unattributable human recording from being registered at all.
 *
 * Every row this suite touches is snapshotted and restored, so it is correct
 * whether or not any Commons candidate has been promoted for real.
 */

import { promises as fs } from 'node:fs';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { resolvePath } from '../../src/lib/audio-storage.js';
import * as storage from '../../src/lib/audio-storage.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { listPhonemeAudio, repointPhonemeAudio } from '../../src/repositories/phonemes.repository.js';
import { produceAsset, registerAsset } from '../../src/services/audio-asset.service.js';
import { resolveActiveVariant } from '../../src/services/catalogue.service.js';

const TEST_PREFIX = 'test-fixture:audio-promotion:';
/** `/ʃ/` is an accepted unit, so a failure here cannot be mistaken for real drift. */
const SYMBOL = 'ʃ';

let variantId;
let originalAssetId;
const writtenStorageKeys = new Set();

/** @param {string} sql @param {unknown[]} [params] */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/** Stand up a ready fixture asset that is not referenced by anything. */
async function givenReadyAsset(name) {
  const assetKey = `${TEST_PREFIX}${name}`;
  await registerAsset({
    variantId,
    assetKey,
    sourceKind: 'tts_piper',
    licenceIdentifier: 'CC-BY-SA-4.0',
    attributionText: 'Test fixture; no audio content is implied.',
  });

  const trackingStorage = {
    async store(bytes, mimeType) {
      const stored = await storage.store(bytes, mimeType);
      writtenStorageKeys.add(stored.storageKey);
      return stored;
    },
    verify: storage.verify,
  };

  await produceAsset({
    assetKey,
    storage: trackingStorage,
    produce: async () => ({ bytes: Buffer.from(`fixture payload ${name}`), mimeType: 'audio/ogg' }),
  });

  const rows = await query('SELECT audio_asset_id FROM audio_assets WHERE asset_key = ?', [assetKey]);
  return rows[0].audio_asset_id;
}

beforeAll(async () => {
  const variant = await resolveActiveVariant('en-us');
  variantId = variant.variantId;

  const rows = await query(
    'SELECT audio_asset_id FROM phonemes WHERE variant_id = ? AND ipa_symbol = ?',
    [variantId, SYMBOL],
  );
  originalAssetId = rows[0].audio_asset_id;
});

afterAll(async () => {
  // Put the unit back on whatever it really serves.
  await query('UPDATE phonemes SET audio_asset_id = ? WHERE variant_id = ? AND ipa_symbol = ?', [
    originalAssetId,
    variantId,
    SYMBOL,
  ]);
  await query('DELETE FROM audio_assets WHERE asset_key LIKE ?', [`${TEST_PREFIX}%`]);
  await closePool();

  for (const key of writtenStorageKeys) {
    await fs.rm(resolvePath(key), { force: true });
  }
});

describe('repointing a phoneme at a replacement', () => {
  test('moves the pointer and returns the asset it superseded', async () => {
    const replacement = await givenReadyAsset('replacement');

    const previous = await repointPhonemeAudio(variantId, SYMBOL, replacement);

    expect(previous).toBe(originalAssetId);
    const [row] = await query(
      'SELECT audio_asset_id FROM phonemes WHERE variant_id = ? AND ipa_symbol = ?',
      [variantId, SYMBOL],
    );
    expect(row.audio_asset_id).toBe(replacement);

    await repointPhonemeAudio(variantId, SYMBOL, originalAssetId);
  });

  test('the superseded asset and its file both survive, so it is reversible', async () => {
    const replacement = await givenReadyAsset('reversible');
    const [before] = await query('SELECT storage_key FROM audio_assets WHERE audio_asset_id = ?', [
      originalAssetId,
    ]);

    await repointPhonemeAudio(variantId, SYMBOL, replacement);

    const [after] = await query('SELECT storage_key FROM audio_assets WHERE audio_asset_id = ?', [
      originalAssetId,
    ]);
    expect(after.storage_key).toBe(before.storage_key);
    await expect(fs.stat(resolvePath(after.storage_key))).resolves.toBeDefined();

    // And pointing back restores exactly the previous state.
    await repointPhonemeAudio(variantId, SYMBOL, originalAssetId);
    const [restored] = await query(
      'SELECT audio_asset_id FROM phonemes WHERE variant_id = ? AND ipa_symbol = ?',
      [variantId, SYMBOL],
    );
    expect(restored.audio_asset_id).toBe(originalAssetId);
  });

  test('an unknown unit repoints nothing and says so', async () => {
    expect(await repointPhonemeAudio(variantId, 'not-a-phoneme', originalAssetId)).toBeNull();
  });
});

describe('listPhonemeAudio follows the pointer, not a derived key', () => {
  test('reports the asset each unit actually serves, with its source kind', async () => {
    const rows = await listPhonemeAudio(variantId);

    expect(rows).toHaveLength(41);
    for (const row of rows) {
      expect(row.audioAssetId).not.toBeNull();
      expect(row.generationStatus).toBe('ready');
      // The key is whatever the unit really serves. Verification must not
      // assume a source: a promoted unit serves `commons_human`.
      expect(row.assetKey).toContain(`phoneme:en-us:${row.ipaSymbol}:`);
    }
  });
});

describe('provenance guards on human recordings', () => {
  test('a human recording with no author is refused', async () => {
    await expect(
      registerAsset({
        variantId,
        assetKey: `${TEST_PREFIX}no-author`,
        sourceKind: 'commons_human',
        sourceReference: 'https://commons.wikimedia.org/wiki/File:Example.ogg',
        licenceIdentifier: 'CC-BY-SA-3.0',
        attributionText: 'Example',
      }),
    ).rejects.toThrow(/must record its author/);
  });

  test('a human recording with no upstream source is refused', async () => {
    await expect(
      registerAsset({
        variantId,
        assetKey: `${TEST_PREFIX}no-source`,
        sourceKind: 'commons_human',
        author: 'Someone',
        licenceIdentifier: 'CC-BY-SA-3.0',
        attributionText: 'Example',
      }),
    ).rejects.toThrow(/must record its upstream source/);
  });

  test('a synthesised asset needs neither, because it has no upstream', async () => {
    await expect(
      registerAsset({
        variantId,
        assetKey: `${TEST_PREFIX}synth-ok`,
        sourceKind: 'tts_piper',
        licenceIdentifier: 'CC-BY-SA-4.0',
        attributionText: 'Synthesised',
      }),
    ).resolves.toBeDefined();
  });
});
