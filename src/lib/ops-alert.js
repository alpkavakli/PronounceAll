/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The operational alert for a background job that exhausted its retries
 * (SDD v1.1 §6.5): an error log line, and an email to the maintainer when
 * `OPS_ALERT_EMAIL` is set — required wherever a worker runs for real.
 *
 * Only the job's name and the error's name and code leave the process: a
 * driver message can echo row values, which are not the alert's business.
 */

import { logger } from './logger.js';

/**
 * @param {object} options
 * @param {import('./mailer.js').SendMail} options.sendMail
 * @param {string} options.to empty to log only
 * @param {string} options.worker which worker raised it
 * @returns {(jobName: string, error: Error) => Promise<void>}
 */
export function createOpsAlert({ sendMail, to, worker }) {
  return async (jobName, error) => {
    const facts = { worker, job: jobName, reason: error?.name ?? 'Error', code: error?.code ?? null };
    logger.error(facts, 'Background job failed after every retry');
    if (!to) return;
    await sendMail({
      to,
      subject: `[PronounceAll] Background job failed: ${jobName}`,
      text:
        `The ${worker} worker's job "${jobName}" failed after every retry and is in the failed set.\n\n` +
        `Error: ${facts.reason}${facts.code ? ` (${facts.code})` : ''}\n` +
        `Time (UTC): ${new Date().toISOString()}\n\n` +
        'Check the worker logs for the full trace.\n',
    }).catch((mailError) => logger.error({ reason: mailError?.name ?? 'Error' }, 'Operational alert email could not be sent'));
  };
}
