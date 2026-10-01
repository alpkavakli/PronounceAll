/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Backups and their restore test (NFR-OPS-01; SDD decision V6).
 *
 * Backup, nightly: one consistent `mysqldump`, gzip-compressed and hashed, is
 * stored as `daily/<timestamp>.sql.gz`, locked for 30 days; on a Sunday (UTC)
 * the same file is stored again as `weekly/<timestamp>.sql.gz`, locked for 26
 * weeks. Each has a manifest beside it, locked alike: its checksum, size, the
 * schema version and the table list. Nothing here deletes; lifecycle rules on
 * the bucket remove copies once their lock lapses.
 *
 * Restore test, weekly: the newest daily backup must be under 26 hours old, so
 * a backup that silently stopped is caught; it is downloaded, its checksum
 * verified, restored into a throwaway MySQL server, and its tables and schema
 * version must match its manifest. Any failure throws, which the worker tier
 * retries and then reports to the maintainer.
 *
 * Infrastructure arrives injected (C4): the dump, the bucket, the scratch
 * server.
 */

import { latestSchemaVersion, listBaseTables } from '../repositories/backup.repository.js';

export const DAILY_RETENTION_DAYS = 30;
export const WEEKLY_RETENTION_DAYS = 26 * 7;
export const MAX_BACKUP_AGE_HOURS = 26;

const DAY_MS = 24 * 60 * 60 * 1000;
const SUFFIX = '.sql.gz';

/** `2026-10-04T013000Z`: sortable, and safe in an object key. */
export function backupStamp(date) {
  return date.toISOString().replace(/:/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const failure = (name, message) => Object.assign(new Error(message), { name, code: name });

/**
 * @param {object} dependencies
 * @param {() => { stream: import('node:stream').Readable, finished: Promise<void> }} dependencies.dumpDatabase
 * @param {(dump: object, path: string) => Promise<{ bytes: number, sha256Hex: string, md5Base64: string }>} dependencies.writeCompressedDump
 * @param {() => import('node:stream').Transform & { result: () => { sha256Hex: string } }} dependencies.hashingTap
 * @param {ReturnType<import('../lib/backup-store.js').createS3BackupStore>} dependencies.store
 * @param {typeof import('../lib/scratch-mysql.js').withScratchMysql} dependencies.withScratchMysql
 * @param {{ create: () => Promise<string>, remove: (path: string) => Promise<void> }} dependencies.tempFile
 * @param {() => Date} [dependencies.clock]
 */
export function createBackupService({ dumpDatabase, writeCompressedDump, hashingTap, store, withScratchMysql, tempFile, clock = () => new Date() }) {
  /** @returns {Promise<{ key: string, bytes: number, weekly: boolean }>} */
  async function runBackup() {
    const now = clock();
    const stamp = backupStamp(now);
    const facts = { schemaVersion: await latestSchemaVersion(), tables: await listBaseTables() };
    const path = await tempFile.create();
    try {
      const artifact = await writeCompressedDump(dumpDatabase(), path);
      const manifest = {
        format: 'mysqldump+gzip',
        createdAt: now.toISOString(),
        bytes: artifact.bytes,
        sha256: artifact.sha256Hex,
        ...facts,
      };
      const copies = [{ prefix: 'daily', days: DAILY_RETENTION_DAYS }];
      if (now.getUTCDay() === 0) copies.push({ prefix: 'weekly', days: WEEKLY_RETENTION_DAYS });
      for (const { prefix, days } of copies) {
        const retainUntil = new Date(now.getTime() + days * DAY_MS);
        const key = `${prefix}/${stamp}${SUFFIX}`;
        await store.putFile(key, { path, bytes: artifact.bytes, md5Base64: artifact.md5Base64, retainUntil });
        await store.putJson(`${key}.json`, manifest, { retainUntil });
      }
      return { key: `daily/${stamp}${SUFFIX}`, bytes: artifact.bytes, weekly: copies.length > 1 };
    } finally {
      await tempFile.remove(path);
    }
  }

  /** @returns {Promise<{ key: string, tables: number, schemaVersion: string|null }>} */
  async function runRestoreTest() {
    const key = await store.latestKey('daily/', SUFFIX);
    if (!key) throw failure('BackupMissing', 'No daily backup exists');
    const manifest = await store.getJson(`${key}.json`);
    const ageHours = (clock().getTime() - Date.parse(manifest.createdAt)) / 3_600_000;
    if (!(ageHours <= MAX_BACKUP_AGE_HOURS)) {
      throw failure('BackupTooOld', `The newest daily backup is ${Math.round(ageHours)} hours old`);
    }

    return withScratchMysql(async ({ restore, connection }) => {
      const tap = hashingTap();
      await restore((await store.getStream(key)).pipe(tap));
      const { sha256Hex } = tap.result();
      if (sha256Hex !== manifest.sha256) throw failure('BackupChecksumMismatch', 'The backup does not match its manifest checksum');

      const tables = await listBaseTables(connection);
      const schemaVersion = await latestSchemaVersion(connection);
      if (JSON.stringify(tables) !== JSON.stringify(manifest.tables)) {
        throw failure('RestoreTablesMismatch', `Restored ${tables.length} tables; the manifest lists ${manifest.tables.length}`);
      }
      if (schemaVersion !== manifest.schemaVersion) {
        throw failure('RestoreSchemaMismatch', `Restored schema ${schemaVersion}; the manifest says ${manifest.schemaVersion}`);
      }
      return { key, tables: tables.length, schemaVersion };
    });
  }

  return { runBackup, runRestoreTest };
}
