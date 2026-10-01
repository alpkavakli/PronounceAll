/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The backup bucket against a real S3-compatible server with Object Lock,
 * Iteration 7 slice 4 (NFR-OPS-01; SDD decision V6). Needs the local stand-in:
 * `docker compose --profile backup up -d backup-s3` (CI runs it as a service).
 *
 * The full path — mysqldump, the upload, and the restore into a throwaway
 * mysqld — runs inside the backup image, where those binaries are; see the
 * slice's completion notes for that end-to-end check.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

const { createS3BackupStore } = await import('../../src/lib/backup-store.js');
const { hashingTap, writeCompressedDump } = await import('../../src/lib/mysql-dump.js');

const bucket = `pa-test-${randomUUID().slice(0, 8)}`;
const store = createS3BackupStore({
  endpoint: process.env.BACKUP_TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9010',
  region: 'us-east-1',
  bucket,
  accessKeyId: 'dev-backup-access',
  secretAccessKey: 'dev-backup-secret-not-a-secret',
  lockMode: 'GOVERNANCE',
});
const tempFiles = [];
const DUMP = '-- MySQL dump\nCREATE TABLE t (id INT);\nINSERT INTO t VALUES (1),(2),(3);\n';

async function compressed() {
  const file = path.join(tmpdir(), `pa-test-${randomUUID()}.sql.gz`);
  tempFiles.push(file);
  const artifact = await writeCompressedDump({ stream: Readable.from([Buffer.from(DUMP)]), finished: Promise.resolve() }, file);
  return { file, artifact };
}

beforeAll(async () => {
  await store.client.send(new CreateBucketCommand({ Bucket: bucket, ObjectLockEnabledForBucket: true }));
});

afterAll(async () => {
  const versions = await store.client.send(new ListObjectVersionsCommand({ Bucket: bucket }));
  for (const entry of [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])]) {
    await store.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.Key, VersionId: entry.VersionId, BypassGovernanceRetention: true }));
  }
  await store.client.send(new DeleteBucketCommand({ Bucket: bucket }));
  for (const file of tempFiles) await rm(file, { force: true });
});

describe('the compressed artifact', () => {
  test('is the dump, gzipped, with the size and both hashes of the compressed bytes', async () => {
    const { file, artifact } = await compressed();
    const bytes = await readFile(file);
    expect(gunzipSync(bytes).toString('utf8')).toBe(DUMP);
    expect(artifact).toEqual({
      bytes: bytes.length,
      sha256Hex: createHash('sha256').update(bytes).digest('hex'),
      md5Base64: createHash('md5').update(bytes).digest('base64'),
    });
  });

  test('a failing dump fails the write', async () => {
    const file = path.join(tmpdir(), `pa-test-${randomUUID()}.sql.gz`);
    tempFiles.push(file);
    const failed = Promise.reject(Object.assign(new Error('mysqldump exited 2'), { name: 'BackupDumpError' }));
    await expect(writeCompressedDump({ stream: Readable.from([]), finished: failed }, file)).rejects.toThrow('mysqldump exited 2');
  });
});

describe('V6 — the bucket', () => {
  test('objects are written encrypted and locked until their retention date', async () => {
    const { file, artifact } = await compressed();
    const retainUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await store.putFile('daily/2026-10-01T013000Z.sql.gz', { path: file, bytes: artifact.bytes, md5Base64: artifact.md5Base64, retainUntil });
    await store.putJson('daily/2026-10-01T013000Z.sql.gz.json', { sha256: artifact.sha256Hex }, { retainUntil });

    for (const key of ['daily/2026-10-01T013000Z.sql.gz', 'daily/2026-10-01T013000Z.sql.gz.json']) {
      const head = await store.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      expect(head.ServerSideEncryption).toBe('AES256');
      expect(head.ObjectLockMode).toBe('GOVERNANCE');
      expect(Math.abs(head.ObjectLockRetainUntilDate.getTime() - retainUntil.getTime())).toBeLessThan(1000);
    }
  });

  test('a locked version cannot be deleted', async () => {
    const versions = await store.client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: 'daily/2026-10-01T013000Z.sql.gz' }));
    const { Key, VersionId } = versions.Versions[0];
    await expect(store.client.send(new DeleteObjectCommand({ Bucket: bucket, Key, VersionId }))).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  test('the newest backup is found by key order, and reads back byte for byte', async () => {
    const { file, artifact } = await compressed();
    const retainUntil = new Date(Date.now() + 24 * 3600 * 1000);
    await store.putFile('daily/2026-10-02T013000Z.sql.gz', { path: file, bytes: artifact.bytes, md5Base64: artifact.md5Base64, retainUntil });
    await store.putJson('daily/2026-10-02T013000Z.sql.gz.json', { sha256: artifact.sha256Hex }, { retainUntil });

    const latest = await store.latestKey('daily/', '.sql.gz');
    expect(latest).toBe('daily/2026-10-02T013000Z.sql.gz');
    expect(await store.getJson(`${latest}.json`)).toEqual({ sha256: artifact.sha256Hex });

    const tap = hashingTap();
    const chunks = [];
    for await (const chunk of (await store.getStream(latest)).pipe(tap)) chunks.push(chunk);
    expect(tap.result().sha256Hex).toBe(artifact.sha256Hex);
    expect(gunzipSync(Buffer.concat(chunks)).toString('utf8')).toBe(DUMP);
    expect(await store.latestKey('weekly/', '.sql.gz')).toBeNull();
  });

  test('a corrupted upload is refused: the Content-MD5 must match', async () => {
    const { file, artifact } = await compressed();
    const wrong = createHash('md5').update('something else').digest('base64');
    await expect(
      store.putFile('daily/2026-10-03T013000Z.sql.gz', { path: file, bytes: artifact.bytes, md5Base64: wrong, retainUntil: new Date(Date.now() + 3600_000) }),
    ).rejects.toBeTruthy();
    expect(await store.latestKey('daily/2026-10-03', '.sql.gz')).toBeNull();
  });
});
