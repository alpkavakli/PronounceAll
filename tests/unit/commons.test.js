/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Commons attribution honesty (FR-CONTENT-04/05, NFR-LEGAL-*).
 *
 * AN UPLOADER IS NOT AN AUTHOR. An earlier version of this pipeline wrote the
 * original uploader's name into `audio_assets.author` and produced attribution
 * reading "by <uploader>", which asserts authorship the source does not
 * support — on 18 of the 24 fetched recordings Commons states no author at all.
 *
 * These tests pin the distinction against the four shapes Commons actually
 * returns for these files, all of which were observed live on 2026-09-11.
 */

import { describe, expect, test } from '@jest/globals';

import { attributionFor, authorCreditFor, classifyAuthorship } from '../../src/lib/commons.js';

/** @param {string} artist @param {object} [extra] */
function described(artist, extra = {}) {
  const classified = classifyAuthorship(artist);
  return {
    artist,
    authorBasis: classified.basis,
    authorName: classified.name,
    uploader: 'Karmosin~commonswiki',
    fileName: 'Voiceless bilabial plosive.ogg',
    licenceName: 'CC BY-SA 3.0',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Voiceless_bilabial_plosive.ogg',
    ...extra,
  };
}

describe('classifyAuthorship', () => {
  test('a bare name is a stated author', () => {
    expect(classifyAuthorship('Erutuon')).toEqual({ basis: 'stated', name: 'Erutuon' });
  });

  test('an empty Artist field is unattributed, not "unknown author"', () => {
    expect(classifyAuthorship('')).toEqual({ basis: 'unattributed', name: '' });
  });

  test("Commons' own assumption is recorded as an assumption", () => {
    expect(
      classifyAuthorship('No machine-readable author provided. Denelson83 assumed (based on copyright claims).'),
    ).toEqual({ basis: 'assumed-by-commons', name: 'Denelson83' });
  });

  test('an Artist field that describes an UPLOADER is not a stated author', () => {
    expect(classifyAuthorship('The original uploader was Octane at English Wikipedia .')).toEqual({
      basis: 'uploader-only',
      name: 'Octane',
    });
  });

  test('a no-author notice with no name attached stays unattributed', () => {
    expect(classifyAuthorship('No machine-readable author provided.')).toEqual({
      basis: 'unattributed',
      name: '',
    });
  });
});

describe('the stored credit never asserts authorship it cannot support', () => {
  test('a stated author is credited plainly', () => {
    expect(authorCreditFor(described('Erutuon'))).toBe('Erutuon');
  });

  test.each([
    ['', 'uploaded to Wikimedia Commons by Karmosin~commonswiki'],
    ['The original uploader was Octane at English Wikipedia .', 'original uploader Octane'],
  ])('an uploader is labelled as an uploader (%s)', (artist, expected) => {
    const credit = authorCreditFor(described(artist));

    expect(credit).toContain('Unattributed');
    expect(credit).toContain(expected);
    expect(credit).toContain('not stated as author');
  });

  test('an assumed author is labelled as assumed', () => {
    const credit = authorCreditFor(
      described('No machine-readable author provided. Denelson83 assumed (based on copyright claims).'),
    );

    expect(credit).toBe('Denelson83 (assumed by Wikimedia Commons; not stated by the source)');
  });

  test('a file with nothing at all still produces a usable credit', () => {
    expect(authorCreditFor(described('', { uploader: '' }))).toBe('Unattributed');
  });
});

describe('attribution text', () => {
  test('only a stated author gets a "by <name>" line', () => {
    expect(attributionFor(described('Erutuon'))).toBe(
      '“Voiceless bilabial plosive” by Erutuon, via Wikimedia Commons, CC BY-SA 3.0.',
    );
  });

  test.each([
    [''],
    ['The original uploader was Octane at English Wikipedia .'],
    ['No machine-readable author provided. Denelson83 assumed (based on copyright claims).'],
  ])('an unstated author never produces "by <uploader>" (%s)', (artist) => {
    const attribution = attributionFor(described(artist));

    expect(attribution).not.toMatch(/” by /);
    expect(attribution).toContain('No author');
    // CC BY-SA is satisfied by crediting the work and its source URI.
    expect(attribution).toContain('https://commons.wikimedia.org/wiki/File:');
  });

  test('every form names the work and the licence', () => {
    for (const artist of ['Erutuon', '', 'The original uploader was Octane at English Wikipedia .']) {
      const attribution = attributionFor(described(artist));
      expect(attribution).toContain('Voiceless bilabial plosive');
      expect(attribution).toContain('CC BY-SA 3.0');
    }
  });
});
