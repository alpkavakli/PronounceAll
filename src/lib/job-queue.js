/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The BullMQ boundary (SDD v1.1 §6.5, C4, C6, V2).
 *
 * Recurring work runs in worker processes separate from Express, so a
 * scheduled job fires once, not once per web instance. Each worker owns one
 * queue and registers its schedules with the Job Schedulers API, which is
 * idempotent: restarting a worker, or running two, never doubles a schedule.
 * Schedules no longer declared are removed at start.
 *
 * Handlers are the thin adapters of `src/jobs/`; the logic lives in services.
 * Retries are bounded with exponential backoff. A job that exhausts them is
 * moved to the failed set and reported through `onExhausted` — the operational
 * alert of §6.5. Duplicate or concurrent execution is made safe by each job's
 * own C6 mechanism, never by the queue.
 */

import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { config } from '../config/index.js';
import { logger } from './logger.js';

/** One queue per worker, and so per database principal (§4.9). */
export const QUEUES = Object.freeze({ ERASURE: 'erasure', MAINTENANCE: 'maintenance', APP: 'app' });

export const JOB_ATTEMPTS = 3;
const BACKOFF = Object.freeze({ type: 'exponential', delay: 60_000 });

/**
 * @typedef {object} JobDefinition
 * @property {string} name stable; it is also the scheduler id
 * @property {{ pattern: string, tz?: string } | { every: number }} repeat
 * @property {() => Promise<object>} run the thin adapter; its result is logged
 */

/** BullMQ needs a blocking-safe connection: no per-request retry limit. */
export function createJobConnection(url = config.redis.url) {
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  connection.on('error', (error) => logger.error({ reason: error?.name ?? 'Error' }, 'Job queue Redis connection error'));
  return connection;
}

/**
 * Register the schedules and start processing.
 *
 * @param {object} options
 * @param {string} options.queueName
 * @param {JobDefinition[]} options.jobs
 * @param {(jobName: string, error: Error) => Promise<void>} options.onExhausted
 * @param {import('ioredis').Redis} options.connection
 * @param {string} [options.prefix] the Redis key prefix (tests isolate with their own)
 * @returns {Promise<{ queue: Queue, worker: Worker, close: () => Promise<void> }>}
 */
export async function startJobWorker({ queueName, jobs, onExhausted, connection, prefix = 'bull' }) {
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const queue = new Queue(queueName, { connection, prefix });

  for (const scheduler of await queue.getJobSchedulers()) {
    if (!byName.has(scheduler.key)) await queue.removeJobScheduler(scheduler.key);
  }
  for (const job of jobs) {
    await queue.upsertJobScheduler(job.name, job.repeat, {
      name: job.name,
      opts: { attempts: JOB_ATTEMPTS, backoff: BACKOFF, removeOnComplete: 100, removeOnFail: 500 },
    });
  }

  const worker = new Worker(
    queueName,
    async (job) => {
      const definition = byName.get(job.name);
      if (!definition) {
        // Left queued by a schedule since retired: nothing to do, nothing to retry.
        logger.warn({ job: job.name }, 'Background job has no handler any more; skipped');
        return { skipped: true };
      }
      return definition.run();
    },
    { connection, prefix, concurrency: 1 },
  );

  worker.on('completed', (job, result) => logger.info({ job: job.name, result }, 'Background job completed'));
  worker.on('failed', (job, error) => {
    if (!job) return;
    // Error name and code only: a driver message can echo row values.
    const reason = { job: job.name, attempt: job.attemptsMade, reason: error?.name ?? 'Error', code: error?.code };
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      onExhausted(job.name, error).catch(() => {});
    } else {
      logger.warn(reason, 'Background job failed; it will be retried');
    }
  });

  return {
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
