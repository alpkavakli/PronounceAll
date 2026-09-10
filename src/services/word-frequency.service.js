/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Headword frequency ranks (FR-WORD-04, decision E1).
 *
 * FR-WORD-04 ranks 404 suggestions "by closeness then by frequency". The rank
 * is deliberately NOT relational state: SDD §4.2 fixes the `words` columns and
 * that schema is frozen, so no `words.frequency` column exists or may be added.
 * Frequency is instead seed/content metadata — fetched by the ingestion
 * pipeline, committed as `data/seed/<variant>.frequency.json`, and merged here
 * into the in-memory headword list that E3 already scans on the 404 path.
 *
 * That placement is also the honest one. The rank describes the LANGUAGE, not
 * this installation's data: it does not change when a word is seeded, re-seeded,
 * or triaged out of `word_requests`, and it carries the upstream's licence and
 * retrieval date like every other piece of ingested content (FR-CONTENT-05).
 *
 * The artifact is read once per variant and cached for the process lifetime. It
 * is small, immutable between deployments, and read only on the 404 path, so
 * nothing here is on the hot path (SDD §4.8).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'data', 'seed');

/**
 * The rank given to a headword the frequency artifact does not cover.
 *
 * FR-WORD-04 orders more common words first, so an unranked word must sort
 * AFTER every ranked one — never ahead of a word known to be common. A word
 * reaches this state legitimately: the artifact covers the seeded list, while a
 * word added later by `word_requests` triage (FR-CONTENT-07) has no rank until
 * the frequency stage is re-run. Ordering among unranked words is then settled
 * by the caller's final headword tie-break, so the result stays deterministic.
 *
 * `Number.MAX_SAFE_INTEGER` rather than `Infinity`: it survives a JSON round
 * trip and arithmetic without becoming `null` or `NaN`.
 */
export const UNRANKED_FREQUENCY = Number.MAX_SAFE_INTEGER;

/**
 * The shape of a variant code, per the `/:variant/:word` URL pattern
 * (FR-WORD-01) and the `language_variants.code` column (SDD §4.2).
 *
 * The code reaches this module already resolved against `language_variants`, so
 * it is not user input. It is still validated before it becomes part of a file
 * path: a traversal sequence in a variant code must never be able to make this
 * read anything outside the seed directory, and a constraint that holds
 * whatever the caller does is worth more than one that relies on every caller.
 */
const VARIANT_CODE = /^[a-z0-9-]{2,12}$/;

/** @type {Map<string, Promise<Map<string, number>>>} variant code to ranks */
const rankCache = new Map();

/**
 * @param {string} variantCode
 * @returns {Promise<Map<string, number>>}
 */
async function readRanks(variantCode) {
  if (!VARIANT_CODE.test(variantCode)) {
    logger.warn({ variantCode }, 'Refusing to read a frequency artifact for a malformed variant');
    return new Map();
  }
  const file = path.join(seedDir, `${variantCode}.frequency.json`);

  try {
    // The path is composed, but `VARIANT_CODE` above admits neither `.` nor a
    // path separator, so the read cannot leave `data/seed/`.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const artifact = JSON.parse(await fs.readFile(file, 'utf8'));
    return new Map(Object.entries(artifact.ranks ?? {}));
  } catch (error) {
    // A missing or unreadable artifact must not take the 404 page down with it.
    // Every headword then falls back to unranked, which degrades the ordering
    // to closeness plus the deterministic headword tie-break — the suggestions
    // are still correct, merely less well ordered.
    logger.warn(
      { err: error, variantCode, file },
      'No frequency artifact could be read; suggestions fall back to unranked ordering',
    );
    return new Map();
  }
}

/**
 * The frequency ranks for a variant, cached for the process lifetime.
 *
 * @param {string} variantCode e.g. `en-us`
 * @returns {Promise<Map<string, number>>} headword to rank, most common lowest
 */
export function loadFrequencyRanks(variantCode) {
  // The PROMISE is cached, not its result, so concurrent 404s share one read.
  let pending = rankCache.get(variantCode);
  if (pending === undefined) {
    pending = readRanks(variantCode);
    rankCache.set(variantCode, pending);
  }
  return pending;
}

/**
 * Drop the cached ranks. Used by tests, and after a re-fetch inside one process.
 *
 * @param {string} [variantCode] one variant, or every variant when omitted
 */
export function invalidateFrequencyRanks(variantCode) {
  if (variantCode === undefined) {
    rankCache.clear();
    return;
  }
  rankCache.delete(variantCode);
}

export default loadFrequencyRanks;
