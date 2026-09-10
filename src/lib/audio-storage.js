/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The audio storage adapter (decision V4, FR-CONTENT-04, SDD v1.1 §6.3).
 *
 * V4 stores pre-generated audio on local disk on the VPS, served by Nginx and
 * cached at the Cloudflare edge, behind a small storage abstraction. This is the
 * concrete filesystem adapter behind that port. It lives in `lib/` with the
 * other infrastructure clients rather than in `repositories/`, which C4 reserves
 * for database access — a later object-storage backend is then a new adapter
 * behind the same port, with no reach into domain logic.
 *
 * **Filenames are content-addressed and immutable.** The storage key is derived
 * from the SHA-256 of the bytes, so a regenerated asset is a NEW file rather
 * than an overwrite. That is what lets §6.3 serve audio as
 * `Cache-Control: public, max-age=31536000, immutable` and never invalidate it:
 * a stale reference cannot occur, because changed content has a different name.
 *
 * The two-character prefix directory keeps any single directory from holding
 * tens of thousands of entries.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config/index.js';
import { logger } from './logger.js';

/** Extension per MIME type. The set is deliberately small and explicit. */
const EXTENSIONS = Object.freeze({
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
});

/**
 * @param {Buffer} bytes
 * @returns {string} lower-case hex SHA-256
 */
export function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Derive the content-addressed storage key for a payload.
 *
 * @param {Buffer} bytes
 * @param {string} mimeType
 * @returns {string} e.g. `ab/abcdef…12.ogg`
 * @throws {Error} on a MIME type the project does not serve
 */
export function storageKeyFor(bytes, mimeType) {
  const extension = EXTENSIONS[mimeType];
  if (!extension) {
    throw new Error(`Unsupported audio MIME type: ${mimeType}`);
  }
  const sha = digest(bytes);
  return `${sha.slice(0, 2)}/${sha}.${extension}`;
}

/** @returns {string} the configured storage root */
function root() {
  return config.audio.storageRoot;
}

/**
 * Absolute path for a storage key, guarded against traversal.
 *
 * @param {string} storageKey
 * @returns {string}
 */
export function resolvePath(storageKey) {
  if (!/^[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/.test(storageKey)) {
    throw new Error(`Malformed storage key: ${storageKey}`);
  }
  return path.join(root(), storageKey);
}

/**
 * Write a payload to its content-addressed location.
 *
 * Idempotent by construction: the same bytes produce the same key, and an
 * existing file with that name is by definition identical, so a re-run is a
 * no-op rather than a rewrite.
 *
 * @param {Buffer} bytes
 * @param {string} mimeType
 * @returns {Promise<{storageKey: string, sha256: string, byteLength: number, written: boolean}>}
 */
export async function store(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error('Refusing to store an empty audio payload (FR-CONTENT-04).');
  }

  const storageKey = storageKeyFor(bytes, mimeType);
  const target = resolvePath(storageKey);

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const exists = await fs.stat(target).then(() => true).catch(() => false);
  if (!exists) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Write to a temporary name and rename, so a reader can never observe a
    // half-written file under a content-addressed name that promises otherwise.
    const temporary = `${target}.${crypto.randomBytes(6).toString('hex')}.part`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(temporary, bytes);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.rename(temporary, target);
  }

  return { storageKey, sha256: digest(bytes), byteLength: bytes.length, written: !exists };
}

/**
 * Verify a stored asset against its recorded digest and length
 * (FR-CONTENT-04's integrity check).
 *
 * @param {{storageKey: string, sha256: string, byteLength: number}} asset
 * @returns {Promise<{ok: boolean, problem?: string}>}
 */
export async function verify(asset) {
  let bytes;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    bytes = await fs.readFile(resolvePath(asset.storageKey));
  } catch (error) {
    return { ok: false, problem: `missing or unreadable: ${error.code ?? error.message}` };
  }

  if (bytes.length === 0) {
    return { ok: false, problem: 'zero-byte file' };
  }
  if (asset.byteLength !== undefined && bytes.length !== Number(asset.byteLength)) {
    return { ok: false, problem: `byte length ${bytes.length}, recorded ${asset.byteLength}` };
  }
  const actual = digest(bytes);
  if (asset.sha256 && actual !== asset.sha256) {
    return { ok: false, problem: `digest ${actual}, recorded ${asset.sha256}` };
  }
  return { ok: true };
}

/**
 * The public URL path Nginx serves an asset from. Kept here so the URL shape and
 * the on-disk layout cannot drift apart.
 *
 * @param {string} storageKey
 * @returns {string}
 */
export function publicPath(storageKey) {
  return `${config.audio.publicPrefix}/${storageKey}`;
}

/** Log the configured root once, so a misconfigured deployment is visible. */
export function describeStorage() {
  logger.info({ root: root(), publicPrefix: config.audio.publicPrefix }, 'Audio storage configured');
}
