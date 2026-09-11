/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SQL for `audio_assets` (SDD v1.1 §4.2, decisions C6, E4, V4, FR-CONTENT-04).
 *
 * Repositories own all database access and issue raw, parameterised SQL through
 * `mysql2` (C4, §7.4). The C6 idempotency mechanism lives here as SQL rather
 * than as application logic, because that is the only place it can be atomic:
 * `UNIQUE (asset_key)` plus a compare-and-set on `generation_status` is what
 * stops two workers generating the same asset.
 */

import { defaultExecutor } from './transaction.js';

/**
 * @typedef {object} AudioAssetRow
 * @property {number} audioAssetId
 * @property {number} variantId
 * @property {string} assetKey
 * @property {string|null} storageKey
 * @property {string|null} sha256
 * @property {string|null} mimeType
 * @property {number|null} byteLength
 * @property {string} generationStatus
 * @property {string} sourceKind
 * @property {string|null} sourceReference
 * @property {string|null} author
 * @property {string} licenceIdentifier
 * @property {string|null} licenceUrl
 * @property {string|null} attributionText
 */

/** @param {object} row @returns {AudioAssetRow} */
function toAudioAsset(row) {
  return {
    audioAssetId: row.audio_asset_id,
    variantId: row.variant_id,
    assetKey: row.asset_key,
    storageKey: row.storage_key,
    sha256: row.sha256,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    generationStatus: row.generation_status,
    sourceKind: row.source_kind,
    sourceReference: row.source_reference,
    author: row.author,
    licenceIdentifier: row.licence_identifier,
    licenceUrl: row.licence_url,
    attributionText: row.attribution_text,
  };
}

/**
 * @param {string} assetKey
 * @param {object} [executor]
 * @returns {Promise<AudioAssetRow | null>}
 */
export async function findByAssetKey(assetKey, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT audio_asset_id, variant_id, asset_key, storage_key, sha256, mime_type,
            byte_length, generation_status, source_kind, source_reference, author,
            licence_identifier, licence_url, attribution_text, retrieved_at
       FROM audio_assets
      WHERE asset_key = ?`,
    [assetKey],
  );
  return rows.length === 0 ? null : toAudioAsset(rows[0]);
}

/**
 * Register an asset the pipeline intends to produce, or return the existing one.
 *
 * This is deliberately an upsert on the deterministic `asset_key`: re-running
 * the seed converges rather than creating a second row for the same target, and
 * the provenance fields are refreshed because they describe the INTENT, which a
 * re-run may legitimately correct. The generated-file columns are never touched
 * here — only {@link markReady} writes those.
 *
 * @param {object} asset
 * @param {object} [executor]
 * @returns {Promise<number>} the `audio_asset_id`
 */
export async function upsertPending(asset, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO audio_assets
       (variant_id, asset_key, generation_status, source_kind, source_reference,
        author, licence_identifier, licence_url, attribution_text, retrieved_at, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       source_kind      = VALUES(source_kind),
       source_reference = VALUES(source_reference),
       author           = VALUES(author),
       licence_identifier = VALUES(licence_identifier),
       licence_url      = VALUES(licence_url),
       attribution_text = VALUES(attribution_text),
       retrieved_at     = VALUES(retrieved_at)`,
    [
      asset.variantId,
      asset.assetKey,
      asset.sourceKind,
      asset.sourceReference ?? null,
      asset.author ?? null,
      asset.licenceIdentifier,
      asset.licenceUrl ?? null,
      asset.attributionText ?? null,
      asset.retrievedAt ?? null,
    ],
  );

  const [rows] = await executor.execute(
    'SELECT audio_asset_id FROM audio_assets WHERE asset_key = ?',
    [asset.assetKey],
  );
  return rows[0].audio_asset_id;
}

/**
 * Atomically claim an asset for generation (C6).
 *
 * The compare-and-set is the whole mechanism: two workers that both observe a
 * claimable row race here, and exactly one sees `affectedRows === 1`. Nothing
 * about this may move into application code, where the check and the write
 * would stop being one operation.
 *
 * A `failed` row is claimable again. Generation must be safe to re-run, and
 * `produceAsset` marks a row `failed` precisely so a crashed attempt does not
 * leave the claim dangling; if `failed` were terminal, the recovery state would
 * itself be unrecoverable, because `upsertPending` deliberately never rewrites
 * `generation_status` and no other path resets it. `ready` is NOT claimable:
 * a produced asset is immutable, and regenerating it is a new key (V4).
 *
 * @param {string} assetKey
 * @param {object} [executor]
 * @returns {Promise<boolean>} true when THIS caller won the claim
 */
export async function claimForGeneration(assetKey, executor = defaultExecutor()) {
  const [result] = await executor.execute(
    `UPDATE audio_assets
        SET generation_status = 'claimed'
      WHERE asset_key = ? AND generation_status IN ('pending', 'failed')`,
    [assetKey],
  );
  return result.affectedRows === 1;
}

/**
 * Record a generated file against its asset.
 *
 * @param {string} assetKey
 * @param {{storageKey: string, sha256: string, mimeType: string, byteLength: number}} file
 * @param {object} [executor]
 * @returns {Promise<void>}
 */
export async function markReady(assetKey, file, executor = defaultExecutor()) {
  await executor.execute(
    `UPDATE audio_assets
        SET storage_key = ?, sha256 = ?, mime_type = ?, byte_length = ?,
            generation_status = 'ready'
      WHERE asset_key = ?`,
    [file.storageKey, file.sha256, file.mimeType, file.byteLength, assetKey],
  );
}

/**
 * @param {string} assetKey
 * @param {object} [executor]
 * @returns {Promise<void>}
 */
export async function markFailed(assetKey, executor = defaultExecutor()) {
  await executor.execute(
    "UPDATE audio_assets SET generation_status = 'failed' WHERE asset_key = ?",
    [assetKey],
  );
}

/**
 * @param {string} status
 * @param {object} [executor]
 * @returns {Promise<AudioAssetRow[]>}
 */
export async function listByStatus(status, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT audio_asset_id, variant_id, asset_key, storage_key, sha256, mime_type,
            byte_length, generation_status, source_kind, source_reference, author,
            licence_identifier, licence_url, attribution_text, retrieved_at
       FROM audio_assets
      WHERE generation_status = ?
      ORDER BY asset_key`,
    [status],
  );
  return rows.map(toAudioAsset);
}

/**
 * Every asset with a file on disk, for the FR-CONTENT-04 integrity check.
 *
 * @param {object} [executor]
 * @returns {Promise<AudioAssetRow[]>}
 */
export async function listReady(executor = defaultExecutor()) {
  return listByStatus('ready', executor);
}

/**
 * Counts by status, for the seed report and the completeness assertion.
 *
 * @param {object} [executor]
 * @returns {Promise<Record<string, number>>}
 */
export async function countByStatus(executor = defaultExecutor()) {
  const [rows] = await executor.query(
    'SELECT generation_status, COUNT(*) AS total FROM audio_assets GROUP BY generation_status',
  );
  return Object.fromEntries(rows.map((row) => [row.generation_status, Number(row.total)]));
}
