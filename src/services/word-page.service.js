/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word-page composition (FR-WORD-01/03/04, decisions B2, E3, E4, SDD §5.3).
 *
 * This is the read side of the B2 split: it composes the SHARED shell content —
 * the word, its meaning, every IPA transcription in `display_order` with the
 * primary leading, the syllable and stress breakdown, and the upstream
 * attribution. It is identical for every viewer of a word, which is what lets
 * the route mark it cacheable.
 *
 * It deliberately reads NO per-viewer state. Save and tag state and the
 * progress-banner count belong to the separate hydration endpoint (B2, SDD
 * §3.4) and arrive in a later iteration; nothing viewer-specific may leak into
 * this path, or the shared cache entry would carry one viewer's data to every
 * other viewer.
 *
 * Iteration 1 renders static IPA TEXT only. Clickable phonemes, `data-phoneme-id`
 * attributes, and whole-word audio are Iteration 2 (Iteration 1 Handoff §8.1,
 * §8.2), so `FR-WORD-03` is intentionally only partially satisfied here.
 */

import { AppError } from '../errors/index.js';
import {
  findPronunciationsByWordId,
  findWordByHeadword,
  listHeadwords,
} from '../repositories/words.repository.js';
import { resolveActiveVariant } from './catalogue.service.js';
import { loadFrequencyRanks, UNRANKED_FREQUENCY } from './word-frequency.service.js';
import { rankSuggestions } from './word-suggestion.service.js';

/**
 * How long the E3 headword list stays cached in process, in milliseconds.
 *
 * The list only changes when the maintainer re-seeds, and it is read only on a
 * 404, so a short TTL costs nothing and bounds how long a freshly seeded word
 * can stay missing from the suggestion list of a running process.
 */
const HEADWORD_CACHE_TTL_MS = 300_000;

/** @type {Map<number, { expiresAt: number, headwords: object[] }>} */
const headwordCache = new Map();

/**
 * The cached headword list E3 scans (SDD §4.8: this path is off the hot path).
 *
 * Each entry carries its `frequencyRank`, merged here from the committed seed
 * artifact rather than read from a column, because FR-WORD-04's "then by
 * frequency" tie-break needs it and SDD §4.2's `words` has no frequency column
 * (see `word-frequency.service.js`). Merging once, when the list is built, keeps
 * the ranking function itself a pure sort over the structure it is given.
 *
 * @param {number} variantId
 * @param {string} variantCode
 * @returns {Promise<Array<{ normalizedHeadword: string, displayHeadword: string,
 *   frequencyRank: number }>>}
 */
async function getCachedHeadwords(variantId, variantCode) {
  const cached = headwordCache.get(variantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.headwords;
  }

  const [rows, ranks] = await Promise.all([
    listHeadwords(variantId),
    loadFrequencyRanks(variantCode),
  ]);
  const headwords = rows.map((row) => ({
    ...row,
    frequencyRank: ranks.get(row.normalizedHeadword) ?? UNRANKED_FREQUENCY,
  }));

  headwordCache.set(variantId, {
    headwords,
    expiresAt: Date.now() + HEADWORD_CACHE_TTL_MS,
  });
  return headwords;
}

/**
 * Drop the cached headword list, so a re-seed inside the same process is
 * visible to the suggestion path immediately. Used by the seed pipeline and by
 * tests that seed and then assert.
 *
 * @param {number} [variantId] one variant, or every variant when omitted
 */
export function invalidateHeadwordCache(variantId) {
  if (variantId === undefined) {
    headwordCache.clear();
    return;
  }
  headwordCache.delete(variantId);
}

/**
 * Resolve a variant code from a URL segment, or fail with a 404.
 *
 * FR-WORD-01 requires the variant to be validated against `language_variants`
 * BEFORE the word lookup runs, and an unsupported variant to 404 rather than
 * fall back to `en-us`. An inactive variant is equally unreachable
 * (FR-CONTENT-06).
 *
 * @param {string} variantCode
 * @returns {Promise<import('../repositories/language-variants.repository.js').LanguageVariant>}
 * @throws {AppError} 404 when the variant is absent or inactive
 */
export async function requireActiveVariant(variantCode) {
  const variant = await resolveActiveVariant(variantCode);
  if (!variant) {
    throw AppError.notFound('That language variant is not available.');
  }
  return variant;
}

/**
 * @typedef {object} WordPage
 * @property {object} variant
 * @property {object} word
 * @property {import('../repositories/words.repository.js').PronunciationRow[]} pronunciations
 * @property {object} primaryPronunciation
 */

/**
 * Compose the shell content for one word page (SDD §5.3).
 *
 * On a miss it throws `AppError.wordNotFound` carrying the E3 suggestions in
 * metadata, so the single error middleware of C2 surfaces the styled
 * fuzzy-suggestion page at a genuine 404 rather than this service formatting a
 * response (FR-WORD-04).
 *
 * @param {object} variant the already-resolved active variant
 * @param {string} slug canonical slug from the validator
 * @returns {Promise<WordPage>}
 * @throws {AppError} 404 `WORD_NOT_FOUND` with `meta.suggestions`
 */
export async function getWordPage(variant, slug) {
  const word = await findWordByHeadword(variant.variantId, slug);

  if (!word) {
    const suggestions = rankSuggestions(slug, await getCachedHeadwords(variant.variantId, variant.code));
    throw AppError.wordNotFound(slug, { meta: { variant, suggestions } });
  }

  const pronunciations = await findPronunciationsByWordId(word.wordId);

  // A word with no pronunciation cannot satisfy FR-WORD-03. Seed validation
  // rejects such a word before load, so reaching here means the catalogue was
  // written around the pipeline; that is a server-side fault, not a 404.
  if (pronunciations.length === 0) {
    throw AppError.internal(
      new Error(`Word ${word.wordId} (${slug}) has no pronunciation rows`),
    );
  }

  return {
    variant,
    word,
    pronunciations,
    // Ingestion guarantees exactly one primary at the lowest `display_order`,
    // so the ordered read already leads with it (E4, FR-WORD-03).
    primaryPronunciation: pronunciations.find((entry) => entry.isPrimary) ?? pronunciations[0],
  };
}
