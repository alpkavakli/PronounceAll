/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word search (FIND-10; reuses decision E3 and FR-WORD-04's ranking).
 *
 * **This feature is implemented ahead of the specification.** The SRS defines
 * navigation as `GET /:variant/:word` alone — Appendix F lists no search
 * endpoint and no `FR-WORD-*` requires one. The gap and the documentation owed
 * are recorded as `FIND-10` in the Backlog and Findings register; a functional
 * requirement, an Appendix F row, and a rate-limit decision are outstanding.
 *
 * Nothing new is invented here. The E3 matcher built for the fuzzy 404 is
 * already a capable word-finder; it was simply unreachable except by typing a
 * URL that fails. This module gives it a front door, over the SAME cached
 * headword list the 404 path uses, so there is one matcher and one cache rather
 * than two that can disagree.
 *
 * The one real difference from the 404 path is input handling. `FR-WORD-02`'s
 * slug validator answers 400 on any character outside the allow-list, which is
 * correct for a URL segment and wrong for a free-text box: someone who types
 * `Cup Cake!` should get results, not an error. So the query is normalised
 * leniently — reduced toward a slug rather than rejected.
 */

import { canonicaliseSlug, MAX_SLUG_LENGTH } from '../validators/word-slug.validator.js';
import { findWordByHeadword } from '../repositories/words.repository.js';
import { getCachedHeadwords } from './word-page.service.js';
import { MAX_SUGGESTIONS, rankSuggestions } from './word-suggestion.service.js';

/** Longest query accepted before truncation, so a huge paste cannot drive work. */
const MAX_QUERY_LENGTH = MAX_SLUG_LENGTH;

/**
 * Reduce free text toward a comparable slug, WITHOUT rejecting it.
 *
 * Whitespace and separators become nothing rather than being refused, so
 * `Cup Cake` finds `cupcake`; characters the allow-list cannot express are
 * dropped for the same reason. An empty result simply means there is nothing to
 * search for, which the caller renders as a prompt rather than an error.
 *
 * @param {unknown} raw the `q` parameter as submitted
 * @returns {string} a comparable term, possibly empty
 */
export function normaliseQuery(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return canonicaliseSlug(raw.slice(0, MAX_QUERY_LENGTH))
    // Collapse anything outside the en-us allow-list. Spaces vanish rather than
    // becoming hyphens: `ice cream` should reach `icecream` before it reaches
    // `ice-cream`, and the ranking recovers the hyphen at one edit either way.
    .replace(/[^a-z'-]+/g, '');
}

/**
 * @typedef {object} SearchOutcome
 * @property {string} query        the normalised term actually searched
 * @property {'empty'|'exact'|'suggestions'|'none'} kind
 * @property {string} [slug]       for `exact`: the headword to redirect to
 * @property {object[]} [suggestions] for `suggestions`: E3-ranked matches
 */

/**
 * Look a word up.
 *
 * An exact hit resolves to a redirect rather than a results page: someone who
 * typed the word wants the word, and a list containing only what they typed is
 * an extra click for nothing.
 *
 * @param {object} variant the resolved active variant
 * @param {unknown} rawQuery
 * @param {number} [limit]
 * @returns {Promise<SearchOutcome>}
 */
export async function searchWords(variant, rawQuery, limit = MAX_SUGGESTIONS) {
  const query = normaliseQuery(rawQuery);

  if (query.length === 0) {
    return { query, kind: 'empty' };
  }

  const exact = await findWordByHeadword(variant.variantId, query);
  if (exact) {
    return { query, kind: 'exact', slug: exact.normalizedHeadword };
  }

  const suggestions = rankSuggestions(
    query,
    await getCachedHeadwords(variant.variantId, variant.code),
    limit,
  );

  return suggestions.length > 0
    ? { query, kind: 'suggestions', suggestions }
    : { query, kind: 'none' };
}

export default searchWords;
