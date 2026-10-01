/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Create the local backup bucket, with Object Lock, on the development S3
 * stand-in (`docker compose --profile backup up`). Development only: the
 * production bucket is created once in Backblaze B2 with Object Lock enabled
 * and lifecycle rules for `daily/` and `weekly/`, as the deployment notes say.
 * Safe to run again.
 *
 * Usage: npm run backup:create-dev-bucket
 */

import process from 'node:process';

import { CreateBucketCommand } from '@aws-sdk/client-s3';

import { config } from '../src/config/index.js';
import { createS3BackupStore } from '../src/lib/backup-store.js';

async function main() {
  if (config.isProductionLike) throw new Error('Development only: create the production bucket in Backblaze B2');
  if (!config.backup.isConfigured) throw new Error('Set the BACKUP_S3_* variables first (see .env.example)');
  const store = createS3BackupStore(config.backup);
  try {
    await store.client.send(new CreateBucketCommand({ Bucket: store.bucket, ObjectLockEnabledForBucket: true }));
    process.stdout.write(`Created bucket ${store.bucket} with Object Lock.\n`);
  } catch (error) {
    if (error?.name !== 'BucketAlreadyOwnedByYou' && error?.name !== 'BucketAlreadyExists') throw error;
    process.stdout.write(`Bucket ${store.bucket} already exists.\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
