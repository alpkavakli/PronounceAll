/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Proven source-profile defects (D4 §5, FR-CONTENT-04).
 *
 * A defect is claimed only from the source's own evidence. These cases pin the
 * two false positives the first report produced — genuine hiatus after a
 * marked diphthong, and an optional rhotic D4 §5.4 already resolves — beside
 * the true defects the detector must still catch.
 */

import { describe, expect, it } from '@jest/globals';

import { findSourceDefects } from '../../src/services/source-defects.service.js';

/** One word, one stored row, one upstream transcription. */
const judge = (headword, stored, units, sourceIpa, accents = []) =>
  findSourceDefects({
    pronunciations: [{ pronunciationId: 1, wordId: 1, ipaTranscription: stored }],
    unitsByPronunciation: new Map([[1, units]]),
    headwordByWordId: new Map([[1, headword]]),
    rawEntries: [{ headword, transcriptions: [{ ipa: sourceIpa, accents }] }],
  }).defects;

describe('offglide evidence', () => {
  it('flags a marked diphthong that became two canonical vowel units', () => {
    const defects = judge('life', 'ˈlʌɪf', ['l', 'ʌ', 'ɪ', 'f'], '/ˈlʌɪ̯f/');
    expect(defects).toHaveLength(1);
    expect(defects[0].reasons[0]).toMatch(/offglide/);
  });

  it('does not flag hiatus after a diphthong the inventory already holds', () => {
    expect(judge('crying', 'ˈkɹaɪ.ɪŋ', ['k', 'ɹ', 'aɪ', 'ɪ', 'ŋ'], '/ˈkɹaɪ̯.ɪŋ/')).toEqual([]);
  });

  it('does not flag GA ɔʊ̯, which the source profile now reads as /oʊ/', () => {
    expect(judge('close', 'ˈkloʊz', ['k', 'l', 'oʊ', 'z'], '/ˈklɔʊ̯z/', ['GA'])).toEqual([]);
  });
});

describe('British notation evidence', () => {
  it('flags an RP GOAT vowel', () => {
    expect(judge('toll', 'təʊl', ['t', 'ə', 'ʊ', 'l'], '/təʊl/')).toHaveLength(1);
  });

  it('does not flag NURSE with an optional rhotic, resolved to /ɝ/ by D4 §5.4', () => {
    expect(judge('burke', 'bɝk', ['b', 'ɝ', 'k'], '/bɜː(ɹ)k/')).toEqual([]);
    expect(judge('bourbon', 'ˈbɝ.bən', ['b', 'ɝ', 'b', 'ə', 'n'], '/ˈbɜː(ɹ).bən/')).toEqual([]);
  });

  it('does not flag NURSE with a written rhotic, which is General American /ɝ/', () => {
    expect(judge('word', 'wɝd', ['w', 'ɝ', 'd'], '/wɜːɹd/')).toEqual([]);
  });
});
