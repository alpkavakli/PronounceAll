/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The backup service, wired to its infrastructure: shared by the scheduled
 * worker and the on-demand command, so both run exactly the same thing.
 */

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { config } from '../config/index.js';
import { createS3BackupStore } from '../lib/backup-store.js';
import { hashingTap, spawnMysqlDump, writeCompressedDump } from '../lib/mysql-dump.js';
import { withScratchMysql } from '../lib/scratch-mysql.js';
import { createBackupService } from '../services/backup.service.js';

export function buildBackupService() {
  if (!config.backup.isConfigured) {
    throw new Error('The backup worker needs BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY');
  }
  return createBackupService({
    dumpDatabase: () => spawnMysqlDump(config.mysql),
    writeCompressedDump,
    hashingTap,
    store: createS3BackupStore(config.backup),
    withScratchMysql,
    tempFile: {
      create: async () => path.join(tmpdir(), `pa-backup-${randomUUID()}.sql.gz`),
      remove: (file) => rm(file, { force: true }),
    },
  });
}
