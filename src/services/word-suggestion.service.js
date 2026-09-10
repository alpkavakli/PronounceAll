/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Fuzzy headword suggestions for the 404 page (FR-WORD-04, decision E3).
 *
 * E3 fixes a two-stage match run in the application over the cached headword
 * list for the active variant:
 *
 *   Stage one generates candidates cheaply — a shared first letter, a shared
 *   Double Metaphone bucket, or a length prefilter standing in for the short
 *   edit-distance prefilter.
 *   Stage two ranks those candidates by a blend of Optimal String Alignment
 *   distance and a Double Metaphone match, and returns the top N.
 *
 * The two signals cover different error classes, which is the whole point: the
 * audience is non-native learners who misspell both by typing slips and by
 * spelling words as they sound. Optimal String Alignment — the restricted form
 * of Damerau-Levenshtein — models an adjacent transposition such as `freind`
 * for `friend` as ONE edit. Plain Levenshtein does not, and Soundex is too
 * crude to stand in for Double Metaphone; E3 rejected both by name, so neither
 * may be substituted here.
 *
 * This path runs only when a word page misses, so it is off the hot path and an
 * in-memory scan of the variant's headword list is affordable. If a later
 * variant grows that list beyond comfortable in-memory scanning, E3 moves
 * candidate generation into a precomputed phonetic-key index column without
 * changing the ranking.
 */

import { doubleMetaphone } from 'double-metaphone';

import { UNRANKED_FREQUENCY } from './word-frequency.service.js';

/** FR-WORD-04: up to five suggestions. */
export const MAX_SUGGESTIONS = 5;

/**
 * Worst blended score still worth showing. Above this the "suggestion" is
 * noise, and FR-WORD-04 explicitly wants a genuinely unmatched slug such as
 * `xqzzy` to show NO suggestions rather than five bad ones.
 */
const MAX_ACCEPTABLE_SCORE = 2.5;

/** Candidates whose length differs by more than this are not worth ranking. */
const CANDIDATE_LENGTH_TOLERANCE = 3;

/** How much a Double Metaphone agreement discounts the blended score. */
const PHONETIC_EXACT_BONUS = 1.5;
const PHONETIC_PARTIAL_BONUS = 0.75;

/**
 * Optimal String Alignment distance: Levenshtein plus a single-cost adjacent
 * transposition (E3).
 *
 * It is the *restricted* Damerau-Levenshtein: a substring is never edited twice,
 * so it does not satisfy the triangle inequality. That is exactly what E3 asks
 * for and it is sufficient here, because the suggestion list is a ranking rather
 * than a metric space.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} edit distance
 */
export function optimalStringAlignment(a, b) {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  // Three rolling rows are all OSA needs: the transposition case reaches back
  // exactly two rows, and nothing reaches further.
  const width = b.length + 1;
  let twoAgo = new Array(width).fill(0);
  let previous = new Array(width);
  let current = new Array(width);

  for (let j = 0; j <= b.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        current[j - 1] + 1, // insertion
        previous[j] + 1, // deletion
        previous[j - 1] + substitutionCost, // substitution
      );
      // The adjacent transposition, counted as a single edit. This is the one
      // operation plain Levenshtein lacks and the reason E3 rejected it.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoAgo[j - 2] + 1);
      }
      current[j] = best;
    }
    const rotated = twoAgo;
    twoAgo = previous;
    previous = current;
    current = rotated;
  }

  return previous[b.length];
}

/**
 * How strongly two Double Metaphone key pairs agree.
 *
 * @param {[string, string]} left
 * @param {[string, string]} right
 * @returns {number} the score discount this agreement earns
 */
function phoneticBonus(left, right) {
  if (left[0] !== '' && left[0] === right[0]) {
    return PHONETIC_EXACT_BONUS;
  }
  // A cross match on the alternate key is a weaker but real signal: Double
  // Metaphone emits two keys precisely because some spellings are pronounced
  // more than one way.
  if (
    (left[0] !== '' && (left[0] === right[1] || left[1] === right[0])) ||
    (left[1] !== '' && left[1] === right[1])
  ) {
    return PHONETIC_PARTIAL_BONUS;
  }
  return 0;
}

/**
 * Stage one — cheap candidate generation (E3).
 *
 * @param {string} slug
 * @param {[string, string]} slugKeys
 * @param {Array<{ normalizedHeadword: string, displayHeadword: string }>} headwords
 * @returns {Array<{ normalizedHeadword: string, displayHeadword: string }>}
 */
function generateCandidates(slug, slugKeys, headwords) {
  return headwords.filter((entry) => {
    const candidate = entry.normalizedHeadword;
    if (Math.abs(candidate.length - slug.length) > CANDIDATE_LENGTH_TOLERANCE) {
      return false;
    }
    if (candidate[0] === slug[0]) {
      return true;
    }
    // A phonetic misspelling can change the first letter — `nife` for `knife` —
    // so a shared Double Metaphone bucket admits a candidate the first-letter
    // test would have dropped.
    return phoneticBonus(slugKeys, doubleMetaphone(candidate)) > 0;
  });
}

/**
 * @typedef {object} Suggestion
 * @property {string} slug           the canonical headword, for the link
 * @property {string} display        the headword as it is written
 * @property {number} score          blended rank; lower is closer
 * @property {number} frequencyRank  corpus frequency; lower is more common
 */

/**
 * Rank fuzzy suggestions for a slug that missed.
 *
 * FR-WORD-04 orders suggestions "by closeness then by frequency", so the sort
 * has three keys:
 *
 *   1. the E3 blended closeness score, ascending — the OSA distance discounted
 *      by a Double Metaphone agreement. This is the primary signal and E3's
 *      algorithm is untouched by the tie-break below it.
 *   2. the frequency rank, ascending, so the more common of two equally close
 *      candidates comes first. That is the requirement's own tie-break, and it
 *      matters: a learner who types `wether` is far likelier to have meant
 *      `weather` than `whether`, and both are one edit away.
 *   3. the headword, so the result is total, deterministic, and reproducible in
 *      tests even when two candidates tie on both score and rank — which every
 *      pair of unranked words does.
 *
 * The rank arrives on the headword structure, merged from the committed seed
 * artifact by the caller (`word-frequency.service.js`); a headword the artifact
 * does not cover sorts after every ranked one. Nothing here reads a database
 * column, because SDD §4.2's `words` has none and that schema is frozen.
 *
 * @param {string} slug the canonical slug that missed
 * @param {Array<{ normalizedHeadword: string, displayHeadword: string,
 *   frequencyRank?: number }>} headwords the cached headword list for the
 *   active variant
 * @param {number} [limit]
 * @returns {Suggestion[]} at most `limit` suggestions, closest first
 */
export function rankSuggestions(slug, headwords, limit = MAX_SUGGESTIONS) {
  if (typeof slug !== 'string' || slug.length === 0 || headwords.length === 0) {
    return [];
  }

  const slugKeys = doubleMetaphone(slug);

  return generateCandidates(slug, slugKeys, headwords)
    .map((entry) => {
      const distance = optimalStringAlignment(slug, entry.normalizedHeadword);
      const bonus = phoneticBonus(slugKeys, doubleMetaphone(entry.normalizedHeadword));
      return {
        slug: entry.normalizedHeadword,
        display: entry.displayHeadword,
        score: distance - bonus,
        // A caller that supplies no rank — an older test fixture, or a variant
        // whose artifact is missing — degrades to closeness plus the headword
        // tie-break rather than sorting unranked words ahead of common ones.
        frequencyRank: entry.frequencyRank ?? UNRANKED_FREQUENCY,
      };
    })
    .filter((suggestion) => suggestion.score <= MAX_ACCEPTABLE_SCORE)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.frequencyRank - b.frequencyRank ||
        a.slug.localeCompare(b.slug),
    )
    .slice(0, limit);
}

export default rankSuggestions;
