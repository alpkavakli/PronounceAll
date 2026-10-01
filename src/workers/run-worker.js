/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The shared bootstrap of the three worker entry points (SDD v1.1 §6.5, C4).
 *
 * Each worker is a composition root of its own: it builds the services its
 * jobs need and hands their thin adapters here. The database credential is the
 * process's own `MYSQL_USER` — the erasure worker runs as `pa_erase`, the
 * maintenance worker as `pa_maint`, the app worker as `pa_app` (§4.9) — so the
 * privilege separation is a matter of deployment, not of code paths.
 *
 * SIGTERM and SIGINT let the running job finish, then close every client.
 */

import process from 'node:process';

import { config } from '../config/index.js';
import { createJobConnection, startJobWorker } from '../lib/job-queue.js';
import { logger } from '../lib/logger.js';
import { createSmtpMailer } from '../lib/mailer.js';
import { closePool, enforceUtcSessions, getPool } from '../lib/mysql.js';
import { createOpsAlert } from '../lib/ops-alert.js';
import { closeRedis } from '../lib/redis.js';

/**
 * @param {object} options
 * @param {string} options.worker its name, for logs and alerts
 * @param {string} options.queueName
 * @param {() => import('../lib/job-queue.js').JobDefinition[]} options.buildJobs
 */
export async function runWorker({ worker, queueName, buildJobs }) {
  if (config.isProductionLike && !config.opsAlertEmail) {
    throw new Error('OPS_ALERT_EMAIL is required for a worker outside development: a failing job must reach the maintainer');
  }
  enforceUtcSessions(getPool());

  const connection = createJobConnection();
  const running = await startJobWorker({
    queueName,
    jobs: buildJobs(),
    connection,
    onExhausted: createOpsAlert({ sendMail: createSmtpMailer(config.mail), to: config.opsAlertEmail, worker }),
  });
  logger.info({ worker, queue: queueName }, 'Worker started');

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ worker, signal }, 'Worker stopping');
    await running.close();
    await connection.quit();
    await closePool();
    await closeRedis();
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
  return { ...running, stop };
}

/** Entry-point wrapper: a start failure is logged and exits non-zero. */
export function main(start) {
  start().catch((error) => {
    logger.fatal({ reason: error?.name ?? 'Error', message: error?.message }, 'Worker failed to start');
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 100).unref();
  });
}
