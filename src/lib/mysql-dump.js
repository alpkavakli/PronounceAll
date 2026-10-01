/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The logical backup (NFR-OPS-01): MySQL's own `mysqldump`, which the backup
 * worker's image carries (it is built from the official MySQL image).
 *
 * `--single-transaction` takes one consistent InnoDB snapshot without locking
 * the application out; `--no-tablespaces` keeps the principal free of the
 * PROCESS privilege; no `CREATE DATABASE` is written, so a dump restores into
 * any database. The password travels in the child's environment, never on its
 * command line, where any process listing would show it.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const DUMP_OPTIONS = Object.freeze([
  '--single-transaction',
  '--quick',
  '--routines',
  '--triggers',
  '--no-tablespaces',
  '--set-gtid-purged=OFF',
  '--hex-blob',
  '--default-character-set=utf8mb4',
]);

/** The last line of a child's stderr, for an error that says why without echoing data. */
const lastLine = (text) => text.trim().split('\n').at(-1) ?? '';

/**
 * @param {{ host: string, port: number, user: string, password: string, database: string }} connection
 * @returns {{ stream: import('node:stream').Readable, finished: Promise<void> }}
 */
export function spawnMysqlDump({ host, port, user, password, database }) {
  const child = spawn('mysqldump', [...DUMP_OPTIONS, `--host=${host}`, `--port=${port}`, `--user=${user}`, database], {
    env: { ...process.env, MYSQL_PWD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`mysqldump exited ${code}: ${lastLine(stderr)}`);
      reject(Object.assign(error, { name: 'BackupDumpError', code: `EXIT_${code}` }));
    });
  });
  return { stream: child.stdout, finished };
}

/** A pass-through that hashes what flows by. */
export function hashingTap() {
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      sha256.update(chunk);
      md5.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  tap.result = () => ({ bytes, sha256Hex: sha256.digest('hex'), md5Base64: md5.digest('base64') });
  return tap;
}

/**
 * Compress a dump to a file, hashing the compressed bytes as they are written.
 *
 * @param {{ stream: import('node:stream').Readable, finished: Promise<void> }} dump
 * @param {string} path
 * @returns {Promise<{ bytes: number, sha256Hex: string, md5Base64: string }>}
 */
export async function writeCompressedDump(dump, path) {
  const tap = hashingTap();
  await Promise.all([
    // The path is the worker's own temporary file, never request input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    pipeline(dump.stream, createGzip({ level: 9 }), tap, createWriteStream(path, { mode: 0o600 })),
    dump.finished,
  ]);
  return tap.result();
}
