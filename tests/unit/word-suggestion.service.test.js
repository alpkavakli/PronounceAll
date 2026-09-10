/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The E3 fuzzy-match algorithm (FR-WORD-04).
 *
 * E3 rejected plain Levenshtein and Soundex BY NAME, so the tests that matter
 * are the ones that would pass with those substitutes swapped in and fail with
 * the algorithm E3 actually specifies — the single-edit transposition, and the
 * phonetic match that recovers a word whose first letter the visitor got wrong.
 */

import { describe, expect, test } from '@jest/globals';

import {
  MAX_SUGGESTIONS,
  optimalStringAlignment,
  rankSuggestions,
} from '../../src/services/word-suggestion.service.js';

/** @param {string[]} words */
function headwords(words) {
  return words.map((word) => ({ normalizedHeadword: word, displayHeadword: word }));
}

const DICTIONARY = headwords([
  'cupcake',
  'cup',
  'cake',
  'pancake',
  'friend',
  'fried',
  'field',
  'knife',
  'nice',
  'business',
  'busy',
  'beautiful',
  'because',
  'water',
  'later',
  'computer',
]);

describe('Optimal String Alignment distance', () => {
  test('an adjacent transposition costs ONE edit, not two', () => {
    // This is why E3 chose OSA over plain Levenshtein, which scores this 2.
    expect(optimalStringAlignment('freind', 'friend')).toBe(1);
    expect(optimalStringAlignment('ab', 'ba')).toBe(1);
  });

  test('insertion, deletion, and substitution each cost one', () => {
    expect(optimalStringAlignment('cupcake', 'cuppcake')).toBe(1);
    expect(optimalStringAlignment('cupcake', 'cupcak')).toBe(1);
    expect(optimalStringAlignment('cupcake', 'cupcaka')).toBe(1);
  });

  test('identical and empty inputs behave', () => {
    expect(optimalStringAlignment('cupcake', 'cupcake')).toBe(0);
    expect(optimalStringAlignment('', 'cake')).toBe(4);
    expect(optimalStringAlignment('cake', '')).toBe(4);
    expect(optimalStringAlignment('', '')).toBe(0);
  });

  test('is symmetric on these inputs', () => {
    expect(optimalStringAlignment('freind', 'friend')).toBe(
      optimalStringAlignment('friend', 'freind'),
    );
  });
});

describe('suggestion ranking', () => {
  test('cuppcake surfaces cupcake — the FR-WORD-04 acceptance criterion', () => {
    const suggestions = rankSuggestions('cuppcake', DICTIONARY);
    expect(suggestions.map((item) => item.slug)).toContain('cupcake');
    expect(suggestions[0].slug).toBe('cupcake');
  });

  test('freind surfaces friend — the transposition case E3 names', () => {
    expect(rankSuggestions('freind', DICTIONARY)[0].slug).toBe('friend');
  });

  test('a phonetic misspelling that changes the first letter still matches', () => {
    // `nife` for `knife`. A first-letter-only candidate filter would miss this;
    // the Double Metaphone bucket is what recovers it.
    expect(rankSuggestions('nife', DICTIONARY).map((item) => item.slug)).toContain('knife');
  });

  test('bizness surfaces business', () => {
    expect(rankSuggestions('bizness', DICTIONARY).map((item) => item.slug)).toContain('business');
  });

  test('xqzzy returns NO suggestions — the second acceptance criterion', () => {
    // Returning five poor guesses would be worse than returning none; the page
    // still offers the word-request control.
    expect(rankSuggestions('xqzzy', DICTIONARY)).toEqual([]);
  });

  test('never returns more than five', () => {
    const many = headwords(
      Array.from({ length: 40 }, (_, index) => `cupcak${String.fromCharCode(97 + index)}`),
    );
    expect(rankSuggestions('cupcake', many).length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  test('is deterministic — equal scores break alphabetically', () => {
    const first = rankSuggestions('cuppcake', DICTIONARY);
    const second = rankSuggestions('cuppcake', DICTIONARY);
    expect(first).toEqual(second);
  });

  test('an empty dictionary or slug yields nothing rather than throwing', () => {
    expect(rankSuggestions('cupcake', [])).toEqual([]);
    expect(rankSuggestions('', DICTIONARY)).toEqual([]);
  });

  test('scores are ascending, closest first', () => {
    const scores = rankSuggestions('cuppcake', DICTIONARY).map((item) => item.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });
});

describe('FR-WORD-04 — the frequency tie-break', () => {
  /** @param {Array<[string, number]>} pairs headword and frequency rank */
  function ranked(pairs) {
    return pairs.map(([word, frequencyRank]) => ({
      normalizedHeadword: word,
      displayHeadword: word,
      frequencyRank,
    }));
  }

  test('two equally close candidates are ordered by frequency', () => {
    // `wether` is one substitution from each, so the closeness score ties and
    // ONLY the frequency rank can decide. This is the assertion the requirement
    // turns on: without the tie-break it would fall through to the alphabetical
    // key and put `weather` after `whether`.
    const dictionary = ranked([
      ['whether', 900],
      ['weather', 100],
    ]);

    const [first, second] = rankSuggestions('wether', dictionary);

    expect(first.score).toBe(second.score);
    expect(first.slug).toBe('weather');
    expect(second.slug).toBe('whether');
  });

  test('frequency never overrides closeness', () => {
    // `cupcake` is an exact match; `cup` is common but far away. Closeness is
    // the primary key, so no frequency rank may promote the worse match.
    const dictionary = ranked([
      ['cup', 1],
      ['cupcake', 9000],
    ]);

    expect(rankSuggestions('cupcake', dictionary)[0].slug).toBe('cupcake');
  });

  test('an unranked headword sorts after a ranked one of equal closeness', () => {
    // A word added by `word_requests` triage before the frequency stage is
    // re-run carries no rank. It must not displace a word known to be common.
    // `weather` is alphabetically first, so only the unranked penalty can put
    // it second — the alphabetical key alone would have led with it.
    const dictionary = [
      { normalizedHeadword: 'weather', displayHeadword: 'weather' },
      { normalizedHeadword: 'whether', displayHeadword: 'whether', frequencyRank: 900 },
    ];

    const [first, second] = rankSuggestions('wether', dictionary);

    expect(first.score).toBe(second.score);
    expect(first.slug).toBe('whether');
    expect(second.slug).toBe('weather');
  });

  test('candidates tied on score and rank still order deterministically', () => {
    const dictionary = ranked([
      ['bead', 500],
      ['bean', 500],
    ]);

    expect(rankSuggestions('beap', dictionary).map((item) => item.slug)).toEqual([
      'bead',
      'bean',
    ]);
  });
});
