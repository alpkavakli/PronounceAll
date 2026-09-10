/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Edge cache invalidation (SDD v1.1 §6.3, decision C4).
 *
 * The word-page shell is cached long-lived at the edge (B2), and its content
 * changes when the maintainer re-seeds a word through the content pipeline. SDD
 * §6.3 therefore specifies an explicit targeted Cloudflare purge by URL, run as
 * a step in the seed pipeline, with the bounded `s-maxage` and
 * `stale-while-revalidate` of the shell acting as a self-healing net so a
 * missed purge corrects itself within the edge TTL.
 *
 * This module is the ADAPTER SEAM for that step. Iteration 1 builds the seam;
 * production Cloudflare credentials and API execution are deferred to the
 * production-edge and deployment work (Iteration 1 Handoff §8.5).
 *
 * The local stack does NOT fake a purge. An unconfigured adapter reports that
 * it purged nothing and says so, because a stub that pretends to have purged
 * would make a missed invalidation invisible exactly when the maintainer is
 * relying on the report to know the edge is consistent.
 */

import { logger } from './logger.js';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

/** Cloudflare accepts at most 30 URLs per purge call. */
const PURGE_BATCH_SIZE = 30;

const PURGE_TIMEOUT_MS = 10_000;

/**
 * @typedef {object} PurgeResult
 * @property {boolean} configured whether a real adapter was wired
 * @property {number} purged      URLs Cloudflare confirmed; 0 when unconfigured
 */

/**
 * The real adapter. Uses an API token scoped to cache purge (SDD §6.4).
 *
 * @param {object} credentials
 * @param {string} credentials.zoneId
 * @param {string} credentials.apiToken
 * @returns {(urls: string[]) => Promise<PurgeResult>}
 */
export function createCloudflarePurger({ zoneId, apiToken }) {
  return async function purgeUrls(urls) {
    let purged = 0;
    for (let start = 0; start < urls.length; start += PURGE_BATCH_SIZE) {
      const batch = urls.slice(start, start + PURGE_BATCH_SIZE);
      const response = await fetch(`${CLOUDFLARE_API}/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ files: batch }),
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(
          `Cloudflare cache purge failed: ${JSON.stringify(result.errors ?? 'unknown error')}`,
        );
      }
      purged += batch.length;
    }
    logger.info({ purged }, 'Purged word-page shells from the edge cache');
    return { configured: true, purged };
  };
}

/**
 * The unconfigured seam. Reports honestly that no purge happened and names the
 * shell TTL that will heal the edge on its own, so a maintainer re-seeding
 * locally knows exactly what state the edge is in.
 *
 * @param {number} shellTtlSeconds the shell `s-maxage`, the self-healing bound
 * @returns {(urls: string[]) => Promise<PurgeResult>}
 */
export function createUnconfiguredPurger(shellTtlSeconds) {
  return async function skipPurge(urls) {
    if (urls.length > 0) {
      logger.info(
        { urls: urls.length, shellTtlSeconds },
        'No Cloudflare cache-purge adapter is configured: nothing was purged. ' +
          'Edge copies of these word pages remain until the shell s-maxage expires.',
      );
    }
    return { configured: false, purged: 0 };
  };
}
