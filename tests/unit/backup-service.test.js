/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The backup policy (NFR-OPS-01; SDD decision V6), against fakes: what is
 * stored where, locked until when, and every way the restore test must fail.
 */

import { PassThrough, Readable } from 'node:stream';

import { describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../../src/repositories/backup.repository.js', () => ({
  listBaseTables: async (executor) => (executor?.restored ? executor.restored.tables : ['alpha', 'beta']),
  latestSchemaVersion: async (executor) => (executor?.restored ? executor.restored.version : '13'),
}));

const { backupStamp, createBackupService, DAILY_RETENTION_DAYS, WEEKLY_RETENTION_DAYS } = await import(
  '../../src/services/backup.service.js'
);
const { scratchEnvironment } = await import('../../src/lib/scratch-mysql.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeStore() {
  const objects = new Map();
  return {
    objects,
    async putFile(key, file) {
      objects.set(key, { kind: 'file', ...file });
    },
    async putJson(key, value, { retainUntil }) {
      objects.set(key, { kind: 'json', value, retainUntil });
    },
    async latestKey(prefix, suffix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix) && key.endsWith(suffix)).sort().at(-1) ?? null;
    },
    async getStream() {
      return Readable.from([Buffer.from('compressed bytes')]);
    },
    async getJson(key) {
      return objects.get(key).value;
    },
  };
}

function service({ now, store = fakeStore(), restored = { tables: ['alpha', 'beta'], version: '13' }, sha = 'abc', failDump = false }) {
  const removed = [];
  const backupService = createBackupService({
    dumpDatabase: () => ({ stream: Readable.from([]), finished: Promise.resolve() }),
    writeCompressedDump: async () => {
      if (failDump) throw Object.assign(new Error('dump failed'), { name: 'BackupDumpError' });
      return { bytes: 42, sha256Hex: 'abc', md5Base64: 'bWQ1' };
    },
    hashingTap: () => Object.assign(new PassThrough(), { result: () => ({ sha256Hex: sha }) }),
    store,
    withScratchMysql: async (work) =>
      work({
        restore: async (stream) => {
          stream.resume();
          await new Promise((resolve) => stream.on('end', resolve));
        },
        connection: { restored },
      }),
    tempFile: { create: async () => '/tmp/dump.sql.gz', remove: async (path) => void removed.push(path) },
    clock: () => now,
  });
  return { backupService, store, removed };
}

describe('the nightly backup', () => {
  test('a weekday: one daily copy and its manifest, locked 30 days, temp file removed', async () => {
    const now = new Date('2026-10-01T01:30:00.000Z'); // a Thursday
    const { backupService, store, removed } = service({ now });
    expect(await backupService.runBackup()).toEqual({ key: 'daily/2026-10-01T013000Z.sql.gz', bytes: 42, weekly: false });

    expect([...store.objects.keys()].sort()).toEqual(['daily/2026-10-01T013000Z.sql.gz', 'daily/2026-10-01T013000Z.sql.gz.json']);
    const file = store.objects.get('daily/2026-10-01T013000Z.sql.gz');
    expect(file).toMatchObject({ path: '/tmp/dump.sql.gz', bytes: 42, md5Base64: 'bWQ1' });
    expect(file.retainUntil.getTime()).toBe(now.getTime() + DAILY_RETENTION_DAYS * DAY_MS);
    expect(store.objects.get('daily/2026-10-01T013000Z.sql.gz.json').value).toEqual({
      format: 'mysqldump+gzip',
      createdAt: now.toISOString(),
      bytes: 42,
      sha256: 'abc',
      schemaVersion: '13',
      tables: ['alpha', 'beta'],
    });
    expect(removed).toEqual(['/tmp/dump.sql.gz']);
  });

  test('a Sunday: also a weekly copy, locked 26 weeks', async () => {
    const now = new Date('2026-10-04T01:30:00.000Z'); // a Sunday
    const { backupService, store } = service({ now });
    expect((await backupService.runBackup()).weekly).toBe(true);
    const weekly = store.objects.get('weekly/2026-10-04T013000Z.sql.gz');
    expect(weekly.retainUntil.getTime()).toBe(now.getTime() + WEEKLY_RETENTION_DAYS * DAY_MS);
    expect(WEEKLY_RETENTION_DAYS).toBe(182);
    expect(store.objects.has('weekly/2026-10-04T013000Z.sql.gz.json')).toBe(true);
  });

  test('a failed dump stores nothing and still removes the temp file', async () => {
    const { backupService, store, removed } = service({ now: new Date('2026-10-01T01:30:00Z'), failDump: true });
    await expect(backupService.runBackup()).rejects.toThrow('dump failed');
    expect(store.objects.size).toBe(0);
    expect(removed).toHaveLength(1);
  });

  test('keys sort by time', () => {
    expect(backupStamp(new Date('2026-10-01T01:30:05.123Z'))).toBe('2026-10-01T013005Z');
    expect(backupStamp(new Date('2026-10-02T00:00:00Z')) > backupStamp(new Date('2026-10-01T23:59:59Z'))).toBe(true);
  });
});

describe('the restore test', () => {
  async function storeWithBackup(createdAt) {
    const { backupService, store } = service({ now: new Date(createdAt) });
    await backupService.runBackup();
    return store;
  }

  test('passes on a recent backup whose checksum, tables and schema match', async () => {
    const store = await storeWithBackup('2026-10-01T01:30:00Z');
    const { backupService } = service({ now: new Date('2026-10-01T05:00:00Z'), store });
    expect(await backupService.runRestoreTest()).toEqual({ key: 'daily/2026-10-01T013000Z.sql.gz', tables: 2, schemaVersion: '13' });
  });

  test.each([
    ['no backup at all', { empty: true }, 'BackupMissing'],
    ['the newest backup is over 26 hours old', { at: '2026-10-02T04:00:00Z' }, 'BackupTooOld'],
    ['the bytes do not match the manifest', { sha: 'tampered' }, 'BackupChecksumMismatch'],
    ['a table is missing after restore', { restored: { tables: ['alpha'], version: '13' } }, 'RestoreTablesMismatch'],
    ['the schema version differs', { restored: { tables: ['alpha', 'beta'], version: '12' } }, 'RestoreSchemaMismatch'],
  ])('fails when %s', async (_label, { empty, at = '2026-10-01T05:00:00Z', ...options }, name) => {
    const store = empty ? fakeStore() : await storeWithBackup('2026-10-01T01:30:00Z');
    const { backupService } = service({ now: new Date(at), store, ...options });
    await expect(backupService.runRestoreTest()).rejects.toMatchObject({ name, code: name });
  });
});

describe('restore isolation', () => {
  test('scratch processes never inherit a MySQL host, port, socket or password from the worker', () => {
    const env = scratchEnvironment({ PATH: '/usr/bin', MYSQL_HOST: 'mysql', MYSQL_PWD: 'x', MYSQL_TCP_PORT: '3306', MYSQL_UNIX_PORT: '/s', mysql_host: 'y', HOME: '/h' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/h' });
  });
});
