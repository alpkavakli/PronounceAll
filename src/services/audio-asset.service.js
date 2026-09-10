/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Audio asset domain logic (decisions C6, E4, V1, V4; FR-CONTENT-03/04,
 * FR-IPA-05, SDD v1.1 §4.2).
 *
 * Two ideas carry this module.
 *
 * **The asset key is deterministic.** It is derived from what the asset IS —
 * kind, target, and generator version — never from a counter or a timestamp.
 * That is what makes the pipeline idempotent under C6: a re-run computes the
 * same key, finds the same row, and does nothing, and two workers that both see
 * a missing asset cannot both generate it because the claim is an atomic
 * compare-and-set on that unique key (see the repository).
 *
 * **A row is a real record, never a placeholder.** A `pending` asset is a
 * genuine, licensed intent to generate a specific file; it is not a stand-in
 * that makes a foreign key satisfiable. `licence_identifier` is therefore
 * required before an asset may be registered at all: an asset whose licence is
 * unknown must never be scheduled for generation, let alone distributed
 * (FR-CONTENT-04, NFR-LEGAL-05).
 *
 * This service holds no infrastructure client. The storage adapter is injected
 * by the caller (C4), so a later object-storage backend is a new adapter behind
 * the same port.
 */

import {
  claimForGeneration,
  countByStatus,
  findByAssetKey,
  listByStatus,
  listReady,
  markFailed,
  markReady,
  upsertPending,
} from '../repositories/audio-assets.repository.js';

/** The generator identity that participates in the asset key (C6). */
export const PIPER_VOICE = 'en_US-libritts-high';

/**
 * Bump when a change to generation would produce different audio for the same
 * target. A new version yields new asset keys, so the batch regenerates rather
 * than silently serving stale audio under a key that promises the new output.
 */
export const GENERATOR_VERSION = 'v1';

/** Asset kinds. `phoneme` audio is FR-IPA-04; `word` audio is FR-IPA-05. */
export const ASSET_KIND = Object.freeze({ PHONEME: 'phoneme', WORD: 'word' });

/**
 * Build the deterministic asset key.
 *
 * The shape is `kind:variant:target:source[:voice:version]`. The voice and
 * version participate only for generated audio, because a human recording is
 * identified by its upstream file rather than by how it was produced.
 *
 * @param {object} options
 * @param {string} options.kind one of {@link ASSET_KIND}
 * @param {string} options.variantCode
 * @param {string} options.target the phoneme symbol, or the word plus discriminator
 * @param {string} options.sourceKind `wiktionary_human` | `tts_piper` | `tts_cloud`
 * @returns {string}
 */
export function assetKeyFor({ kind, variantCode, target, sourceKind }) {
  if (!Object.values(ASSET_KIND).includes(kind)) {
    throw new Error(`Unknown audio asset kind: ${kind}`);
  }
  const base = `${kind}:${variantCode}:${target}:${sourceKind}`;
  return sourceKind === 'wiktionary_human'
    ? base
    : `${base}:${PIPER_VOICE}:${GENERATOR_VERSION}`;
}

/**
 * Register the intent to hold an audio asset, returning its id.
 *
 * @param {object} asset
 * @param {object} [executor]
 * @returns {Promise<number>}
 * @throws {Error} when provenance required by FR-CONTENT-04 is absent
 */
export async function registerAsset(asset, executor) {
  if (!asset.licenceIdentifier) {
    throw new Error(
      `Refusing to register ${asset.assetKey}: FR-CONTENT-04 requires a licence identifier ` +
        'before an asset may be scheduled or distributed.',
    );
  }
  if (asset.sourceKind === 'wiktionary_human' && !asset.sourceReference) {
    throw new Error(
      `Refusing to register ${asset.assetKey}: a human recording must record its upstream source.`,
    );
  }
  return upsertPending(asset, executor);
}

/**
 * Claim, fetch or generate, store, and record one asset.
 *
 * `produce` is injected — the Wikimedia fetcher, the Piper batch, or a test
 * double — so this service depends on no concrete client and the same flow
 * serves every source (C4, V1).
 *
 * @param {object} options
 * @param {string} options.assetKey
 * @param {{store: (bytes: Buffer, mime: string) => Promise<object>}} options.storage
 * @param {() => Promise<{bytes: Buffer, mimeType: string}>} options.produce
 * @returns {Promise<{status: string, storageKey?: string, reason?: string}>}
 */
export async function produceAsset({ assetKey, storage, produce }) {
  const existing = await findByAssetKey(assetKey);
  if (!existing) {
    return { status: 'unknown', reason: 'no asset row is registered under that key' };
  }
  if (existing.generationStatus === 'ready') {
    return { status: 'already-ready', storageKey: existing.storageKey };
  }

  // C6: exactly one caller wins this, whatever else is running.
  if (!(await claimForGeneration(assetKey))) {
    return { status: 'not-claimed', reason: 'another worker holds the claim, or it already ran' };
  }

  try {
    const { bytes, mimeType } = await produce();
    const stored = await storage.store(bytes, mimeType);
    await markReady(assetKey, {
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      mimeType,
      byteLength: stored.byteLength,
    });
    return { status: 'ready', storageKey: stored.storageKey };
  } catch (error) {
    // The claim must not be left dangling, or the asset can never be retried.
    await markFailed(assetKey);
    return { status: 'failed', reason: error.message };
  }
}

/**
 * Verify every ready asset against its recorded digest, length, and MIME type
 * (FR-CONTENT-04's startup or nightly integrity check).
 *
 * @param {{verify: (asset: object) => Promise<{ok: boolean, problem?: string}>}} storage
 * @returns {Promise<{checked: number, problems: Array<{assetKey: string, problem: string}>}>}
 */
export async function verifyIntegrity(storage) {
  const assets = await listReady();
  const problems = [];

  for (const asset of assets) {
    const result = await storage.verify(asset);
    if (!result.ok) {
      problems.push({ assetKey: asset.assetKey, problem: result.problem });
    }
  }

  return { checked: assets.length, problems };
}

/**
 * @param {object} [executor]
 * @returns {Promise<Record<string, number>>}
 */
export async function statusSummary(executor) {
  return countByStatus(executor);
}

/**
 * @param {string} status
 * @param {object} [executor]
 * @returns {Promise<object[]>}
 */
export async function assetsWithStatus(status, executor) {
  return listByStatus(status, executor);
}

export { findByAssetKey };
