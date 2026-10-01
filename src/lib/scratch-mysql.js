/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * A throwaway MySQL server for the restore test (V6: "restore tested on a
 * schedule"). The backup worker's image is the official MySQL image, so it can
 * start its own `mysqld` in a temporary directory, with no network listener,
 * and restore into that. The production database is never touched and no
 * privilege on it is needed; the directory is removed afterwards, whatever
 * happened.
 *
 * Isolation is enforced twice, because MySQL's client programs read
 * `MYSQL_HOST`, `MYSQL_PWD` and friends from the environment, and the worker's
 * own `MYSQL_HOST` names the real database: every scratch process runs with
 * those variables removed, and the client is pinned to the scratch socket with
 * `--protocol=SOCKET`, so it cannot fall back to TCP towards production.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createGunzip } from 'node:zlib';

import mysql from 'mysql2/promise';

/** The database the dump is restored into. */
export const RESTORE_DATABASE = 'restore_check';

/** The environment of every scratch process: the worker's, minus anything that could point a MySQL program elsewhere. */
export function scratchEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^MYSQL/i.test(name)));
}

/** Run a command to completion, optionally feeding it a stream. */
function run(command, args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'], env: scratchEnvironment() });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${command} exited ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`);
      reject(Object.assign(error, { name: 'RestoreError', code: `EXIT_${code}` }));
    });
    if (stdin) {
      stdin.on('error', (error) => child.stdin.destroy(error));
      child.stdin.on('error', () => {});
      stdin.pipe(child.stdin);
    }
  });
}

/**
 * @template T
 * @param {(scratch: {
 *   restore: (gzipped: import('node:stream').Readable) => Promise<void>,
 *   connection: import('mysql2/promise').Connection,
 * }) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withScratchMysql(work) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-restore-'));
  const datadir = path.join(dir, 'data');
  const socket = path.join(dir, 'mysqld.sock');
  const common = [`--datadir=${datadir}`, `--log-error=${path.join(dir, 'error.log')}`];
  let server;
  let connection;
  try {
    await run('mysqld', ['--no-defaults', '--initialize-insecure', ...common]);
    server = spawn(
      'mysqld',
      [
        '--no-defaults',
        ...common,
        `--socket=${socket}`,
        `--pid-file=${path.join(dir, 'mysqld.pid')}`,
        '--skip-networking',
        '--mysqlx=OFF',
        '--innodb-buffer-pool-size=64M',
      ],
      { stdio: 'ignore', env: scratchEnvironment() },
    );
    for (let attempt = 0; ; attempt += 1) {
      try {
        connection = await mysql.createConnection({ socketPath: socket, user: 'root', multipleStatements: false });
        break;
      } catch (cause) {
        if (attempt >= 120) {
          throw Object.assign(new Error('The scratch MySQL server did not start'), { name: 'RestoreError', cause });
        }
        await sleep(500);
      }
    }
    await connection.query('CREATE DATABASE restore_check');
    await connection.query('USE restore_check');

    const restore = (gzipped) =>
      run('mysql', ['--no-defaults', '--protocol=SOCKET', `--socket=${socket}`, '--user=root', '--default-character-set=utf8mb4', RESTORE_DATABASE], {
        stdin: gzipped.pipe(createGunzip()),
      });
    return await work({ restore, connection });
  } finally {
    await connection?.end().catch(() => {});
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill('SIGTERM');
      await Promise.race([exited, sleep(30_000)]);
    }
    await rm(dir, { recursive: true, force: true });
  }
}
