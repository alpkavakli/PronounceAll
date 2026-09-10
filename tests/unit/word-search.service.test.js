/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Query normalisation for word search (FIND-10).
 *
 * The point of these is the DIFFERENCE from `normaliseWordSlug`. That validator
 * answers 400 on anything outside the allow-list, which is right for a URL
 * segment and wrong for a free-text box: a reader typing `Cup Cake!` should get
 * results rather than an error page. Every case below would be a 400 on the
 * word route and must not be one here.
 */

import { describe, expect, test } from '@jest/globals';

import { normaliseQuery } from '../../src/services/word-search.service.js';
import { normaliseWordSlug } from '../../src/validators/word-slug.validator.js';

describe('FIND-10 — the query is normalised, never rejected', () => {
  test.each([
    ['Cupcake', 'cupcake'],
    ['  cupcake  ', 'cupcake'],
    ['Cup Cake', 'cupcake'],
    ['Cup Cake!', 'cupcake'],
    ['cup_cake', 'cupcake'],
    ['CUPCAKE', 'cupcake'],
    ['don’t', 'dont'],
    ['mother-in-law', 'mother-in-law'],
    ["don't", "don't"],
    ['café', 'caf'],
    ['123cupcake', 'cupcake'],
  ])('%j normalises to %j', (raw, expected) => {
    expect(normaliseQuery(raw)).toBe(expected);
  });

  test('input that the slug validator rejects still yields a searchable term', () => {
    // The contrast in one assertion: the same string, two correct behaviours.
    expect(() => normaliseWordSlug('Cup Cake!', 'en-us')).toThrow();
    expect(normaliseQuery('Cup Cake!')).toBe('cupcake');
  });

  test('a query of only punctuation reduces to empty rather than throwing', () => {
    expect(normaliseQuery('!!!')).toBe('');
    expect(normaliseQuery('   ')).toBe('');
  });

  test('a non-string is empty rather than an error', () => {
    // Express hands an array when a parameter repeats: `?q=a&q=b`.
    expect(normaliseQuery(undefined)).toBe('');
    expect(normaliseQuery(['a', 'b'])).toBe('');
    expect(normaliseQuery(null)).toBe('');
  });

  test('an over-long query is truncated rather than driving unbounded work', () => {
    expect(normaliseQuery('a'.repeat(5000))).toHaveLength(128);
  });

  test('a null byte cannot survive normalisation', () => {
    expect(normaliseQuery('cup\u0000cake')).toBe('cupcake');
  });
});
