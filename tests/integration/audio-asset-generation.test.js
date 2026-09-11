/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The audio generation invariants (C6, V1, V4, FR-CONTENT-04).
 *
 * These test the mechanism the Piper batch will run on, against the real
 * database and the real filesystem, BEFORE any audio exists — because the
 * mechanism is what makes generation safe to re-run, and a defect in it is
 * discovered at the worst possible moment otherwise.
 *
 * What is asserted here is the invariant, not the happy path:
 *
 *   - the claim is an atomic compare-and-set, so concurrent workers cannot both
 *     generate the same asset;
 *   - a failed attempt is recoverable, because a `failed` row that could never
 *     be re-claimed would be a permanent hole in the inventory;
 *   - a row cannot reach `ready` without a real file, digest, length and MIME
 *     type — the database refuses it, not merely the application;
 *   - re-running converges instead of duplicating.
 *
 * `produce` is a test double returning fixed bytes. It stands for the generator
 * and asserts nothing about audio content: no phoneme audio exists yet, and
 * this suite deliberately does not pretend otherwise.
 */

import { promises as fs } from 'node:fs';

import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { resolvePath } from '../../src/lib/audio-storage.js';
import * as storage from '../../src/lib/audio-storage.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { claimForGeneration } from '../../src/repositories/audio-assets.repository.js';
import { produceAsset, registerAsset } from '../../src/services/audio-asset.service.js';

/** Every key this suite creates starts here, so cleanup can never touch real assets. */
const TEST_PREFIX = 'test-fixture:audio-asset-generation:';
const OGG = 'audio/ogg';

/** @param {string} sql @param {unknown[]} [params] */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function variantId() {
  const rows = await query("SELECT variant_id FROM language_variants WHERE code = 'en-us'");
  return rows[0].variant_id;
}

/** Register a pending fixture asset and return its key. */
async function givenPendingAsset(name) {
  const assetKey = `${TEST_PREFIX}${name}`;
  await registerAsset({
    variantId: await variantId(),
    assetKey,
    sourceKind: 'tts_piper',
    licenceIdentifier: 'CC-BY-SA-4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionText: 'Test fixture; no audio content is implied.',
  });
  return assetKey;
}

/** @param {string} assetKey */
async function statusOf(assetKey) {
  const rows = await query('SELECT generation_status FROM audio_assets WHERE asset_key = ?', [assetKey]);
  return rows[0]?.generation_status;
}

/** @param {string} assetKey */
async function rowOf(assetKey) {
  const rows = await query(
    `SELECT storage_key, sha256, mime_type, byte_length, generation_status
       FROM audio_assets WHERE asset_key = ?`,
    [assetKey],
  );
  return rows[0];
}

/** Bytes unique to a test, so each one gets its own content-addressed file. */
function bytesFor(name) {
  return Buffer.from(`pronounceall test fixture payload for ${name}`);
}

/** A producer double. */
function producerOf(name) {
  return jest.fn(async () => ({ bytes: bytesFor(name), mimeType: OGG }));
}

const writtenStorageKeys = new Set();

/** Track what the double stored so the files can be removed afterwards. */
const trackingStorage = {
  async store(bytes, mimeType) {
    const stored = await storage.store(bytes, mimeType);
    writtenStorageKeys.add(stored.storageKey);
    return stored;
  },
  verify: storage.verify,
};

beforeEach(async () => {
  await query('DELETE FROM audio_assets WHERE asset_key LIKE ?', [`${TEST_PREFIX}%`]);
});

afterAll(async () => {
  await query('DELETE FROM audio_assets WHERE asset_key LIKE ?', [`${TEST_PREFIX}%`]);
  await closePool();

  for (const key of writtenStorageKeys) {
    await fs.rm(resolvePath(key), { force: true });
  }
});

describe('C6 — the claim is atomic', () => {
  test('exactly one of many concurrent workers wins the claim', async () => {
    const assetKey = await givenPendingAsset('concurrent-claim');

    const results = await Promise.all(Array.from({ length: 8 }, () => claimForGeneration(assetKey)));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await statusOf(assetKey)).toBe('claimed');
  });

  test('a ready asset is never re-claimed, because a produced asset is immutable (V4)', async () => {
    const assetKey = await givenPendingAsset('ready-not-reclaimable');
    await produceAsset({ assetKey, storage: trackingStorage, produce: producerOf('ready-not-reclaimable') });

    expect(await claimForGeneration(assetKey)).toBe(false);
    expect(await statusOf(assetKey)).toBe('ready');
  });
});

describe('produceAsset', () => {
  test('records the file, digest, length and MIME type, and the file exists', async () => {
    const assetKey = await givenPendingAsset('happy-path');
    const produce = producerOf('happy-path');

    const result = await produceAsset({ assetKey, storage: trackingStorage, produce });

    expect(result.status).toBe('ready');
    const row = await rowOf(assetKey);
    expect(row.generation_status).toBe('ready');
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(row.byte_length)).toBe(bytesFor('happy-path').length);
    expect(row.mime_type).toBe(OGG);
    await expect(fs.stat(resolvePath(row.storage_key))).resolves.toBeDefined();
  });

  test('an unregistered key produces nothing', async () => {
    const produce = producerOf('unknown');

    const result = await produceAsset({ assetKey: `${TEST_PREFIX}never-registered`, storage: trackingStorage, produce });

    expect(result.status).toBe('unknown');
    expect(produce).not.toHaveBeenCalled();
  });

  test('re-running a ready asset does not regenerate it', async () => {
    const assetKey = await givenPendingAsset('rerun-ready');
    await produceAsset({ assetKey, storage: trackingStorage, produce: producerOf('rerun-ready') });

    const second = producerOf('rerun-ready');
    const result = await produceAsset({ assetKey, storage: trackingStorage, produce: second });

    expect(result.status).toBe('already-ready');
    expect(second).not.toHaveBeenCalled();
  });

  test('a concurrent second worker does not generate the same asset twice', async () => {
    const assetKey = await givenPendingAsset('concurrent-produce');
    const first = producerOf('concurrent-produce');
    const second = producerOf('concurrent-produce');

    const [a, b] = await Promise.all([
      produceAsset({ assetKey, storage: trackingStorage, produce: first }),
      produceAsset({ assetKey, storage: trackingStorage, produce: second }),
    ]);

    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(['not-claimed', 'ready']);
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1);
  });
});

describe('a failed attempt is recoverable (re-runnability)', () => {
  test('a throwing producer marks the row failed and stores no file', async () => {
    const assetKey = await givenPendingAsset('producer-throws');

    const result = await produceAsset({
      assetKey,
      storage: trackingStorage,
      produce: async () => {
        throw new Error('piper exited non-zero');
      },
    });

    expect(result.status).toBe('failed');
    const row = await rowOf(assetKey);
    expect(row.generation_status).toBe('failed');
    expect(row.storage_key).toBeNull();
    expect(row.sha256).toBeNull();
  });

  test('a failed asset can be produced on a later run', async () => {
    const assetKey = await givenPendingAsset('failed-then-retried');
    await produceAsset({
      assetKey,
      storage: trackingStorage,
      produce: async () => {
        throw new Error('transient failure');
      },
    });
    expect(await statusOf(assetKey)).toBe('failed');

    const result = await produceAsset({
      assetKey,
      storage: trackingStorage,
      produce: producerOf('failed-then-retried'),
    });

    expect(result.status).toBe('ready');
    expect(await statusOf(assetKey)).toBe('ready');
  });

  test('re-seeding does not resurrect a failed row by itself', async () => {
    const assetKey = await givenPendingAsset('reseed-keeps-status');
    await produceAsset({
      assetKey,
      storage: trackingStorage,
      produce: async () => {
        throw new Error('failed once');
      },
    });

    await givenPendingAsset('reseed-keeps-status');

    // upsertPending refreshes provenance but never rewrites generation_status,
    // so recovery is the claim's job, not the seed's.
    expect(await statusOf(assetKey)).toBe('failed');
  });
});

describe('FR-CONTENT-04 — the database refuses an incomplete ready row', () => {
  test('ready without a digest, length, key or MIME type is rejected', async () => {
    const assetKey = await givenPendingAsset('incomplete-ready');

    await expect(
      query("UPDATE audio_assets SET generation_status = 'ready' WHERE asset_key = ?", [assetKey]),
    ).rejects.toThrow();

    expect(await statusOf(assetKey)).toBe('pending');
  });

  test('an integrity check detects a file deleted underneath a ready row', async () => {
    const assetKey = await givenPendingAsset('tampered');
    await produceAsset({ assetKey, storage: trackingStorage, produce: producerOf('tampered') });
    const row = await rowOf(assetKey);

    await fs.rm(resolvePath(row.storage_key), { force: true });

    const verified = await storage.verify({
      storageKey: row.storage_key,
      sha256: row.sha256,
      byteLength: row.byte_length,
    });
    expect(verified.ok).toBe(false);
    expect(verified.problem).toMatch(/missing or unreadable/);
  });

  test('an integrity check detects a digest mismatch', async () => {
    const assetKey = await givenPendingAsset('digest-mismatch');
    await produceAsset({ assetKey, storage: trackingStorage, produce: producerOf('digest-mismatch') });
    const row = await rowOf(assetKey);

    const verified = await storage.verify({
      storageKey: row.storage_key,
      sha256: 'f'.repeat(64),
      byteLength: row.byte_length,
    });

    expect(verified.ok).toBe(false);
    expect(verified.problem).toMatch(/digest/);
  });
});

describe('registerAsset guards provenance', () => {
  test('a human recording without an upstream source reference is refused', async () => {
    await expect(
      registerAsset({
        variantId: await variantId(),
        assetKey: `${TEST_PREFIX}human-no-source`,
        sourceKind: 'wiktionary_human',
        licenceIdentifier: 'CC-BY-SA-3.0',
      }),
    ).rejects.toThrow(/must record its upstream source/);
  });
});
