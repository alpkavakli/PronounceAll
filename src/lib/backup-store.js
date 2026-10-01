/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The off-site backup bucket (NFR-OPS-01; SDD decision V6): Backblaze B2 in
 * production, through its S3-compatible API.
 *
 * Every object is written with server-side encryption and an Object Lock
 * retention date, in COMPLIANCE mode in production, so not even the bucket's
 * owner can delete or shorten it before that date. The backup key needs and
 * gets no delete right: expired copies are removed by the bucket's lifecycle
 * rules once their lock has lapsed. Content-MD5 is sent with every write, as
 * S3 requires for a locked object.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * @param {object} options
 * @param {string} options.endpoint
 * @param {string} options.region
 * @param {string} options.bucket
 * @param {string} options.accessKeyId
 * @param {string} options.secretAccessKey
 * @param {'COMPLIANCE'|'GOVERNANCE'} options.lockMode
 */
export function createS3BackupStore({ endpoint, region, bucket, accessKeyId, secretAccessKey, lockMode }) {
  const s3 = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    // S3-compatible targets differ on the newer default checksums; Content-MD5 is sent explicitly.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const locked = (retainUntil) => ({
    ServerSideEncryption: 'AES256',
    ObjectLockMode: lockMode,
    ObjectLockRetainUntilDate: retainUntil,
  });

  return {
    bucket,
    client: s3,

    /**
     * @param {string} key
     * @param {{ path: string, bytes: number, md5Base64: string, retainUntil: Date }} file
     */
    async putFile(key, { path, bytes, md5Base64, retainUntil }) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          // The path is the worker's own temporary file, never request input.
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          Body: createReadStream(path),
          ContentLength: bytes,
          ContentMD5: md5Base64,
          ContentType: 'application/gzip',
          ...locked(retainUntil),
        }),
      );
    },

    /** @param {string} key @param {object} value @param {{ retainUntil: Date }} options */
    async putJson(key, value, { retainUntil }) {
      const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentMD5: createHash('md5').update(body).digest('base64'),
          ContentType: 'application/json',
          ...locked(retainUntil),
        }),
      );
    },

    /**
     * @param {string} prefix
     * @param {string} suffix
     * @returns {Promise<string|null>} the greatest key; keys are timestamp-named, so the newest
     */
    async latestKey(prefix, suffix) {
      let latest = null;
      let ContinuationToken;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }));
        for (const { Key } of page.Contents ?? []) {
          if (Key.endsWith(suffix) && (latest === null || Key > latest)) latest = Key;
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return latest;
    },

    /** @returns {Promise<import('node:stream').Readable>} */
    async getStream(key) {
      return (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body;
    },

    async getJson(key) {
      const body = (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body;
      return JSON.parse(await body.transformToString('utf8'));
    },
  };
}
