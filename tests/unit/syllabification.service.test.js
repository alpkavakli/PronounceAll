/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Syllable boundaries (FR-WORD-03, FR-IPA-01, D4 §3.8).
 *
 * The interesting cases are the refusals. This module writes into the
 * transcription a learner reads, so every test that proves it declines —
 * on an existing separator, an unalignable string, an illegal cluster — is
 * guarding against a wrong boundary being presented as fact.
 */

import { describe, expect, it } from '@jest/globals';

import { insertSyllableMarks, isLegalOnset, syllabify } from '../../src/services/syllabification.service.js';

const C = (ipaSymbol) => ({ ipaSymbol, category: 'consonant' });
const V = (ipaSymbol) => ({ ipaSymbol, category: 'vowel' });
const D = (ipaSymbol) => ({ ipaSymbol, category: 'diphthong' });
const R = (ipaSymbol) => ({ ipaSymbol, category: 'central rhotic' });

describe('isLegalOnset', () => {
  it('accepts the clusters English actually begins syllables with', () => {
    expect(isLegalOnset(['l'])).toBe(true);
    expect(isLegalOnset(['t', 'ɹ'])).toBe(true);
    expect(isLegalOnset(['s', 'p', 'ɹ'])).toBe(true);
  });

  it('rejects clusters English does not', () => {
    expect(isLegalOnset(['ɹ', 'l'])).toBe(false);
    expect(isLegalOnset(['ŋ'])).toBe(false); // cannot open a syllable
    expect(isLegalOnset(['k', 's', 't', 'ɹ'])).toBe(false); // over-long
  });
});

describe('syllabify', () => {
  it('gives a single intervocalic consonant to the following syllable', () => {
    // w ɔ . t ɚ
    expect(syllabify([C('w'), V('ɔ'), C('t'), R('ɚ')])).toEqual([0, 2]);
  });

  it('splits a cluster that cannot open a syllable', () => {
    // d ɑ ɹ . l ɪ ŋ — /ɹl/ is not a legal onset, so /ɹ/ closes the first
    expect(syllabify([C('d'), V('ɑ'), C('ɹ'), C('l'), V('ɪ'), C('ŋ')])).toEqual([0, 3]);
  });

  it('keeps a legal cluster whole as the next onset', () => {
    // ə . ɡɹ iː -> maximal onset takes both
    expect(syllabify([V('ə'), C('ɡ'), C('ɹ'), V('i')])).toEqual([0, 1]);
  });

  it('puts a boundary between adjacent nuclei', () => {
    expect(syllabify([C('k'), V('i'), V('ɑ')])).toEqual([0, 2]);
  });

  it('returns one syllable when there is at most one nucleus', () => {
    expect(syllabify([C('k'), V('æ'), C('t')])).toEqual([0]);
    expect(syllabify([])).toEqual([]);
  });
});

describe('insertSyllableMarks', () => {
  it('adds the separator the source omitted', () => {
    const units = [C('d'), V('ɑ'), C('ɹ'), C('l'), V('ɪ'), C('ŋ')];
    expect(insertSyllableMarks('ˈdɑɹlɪŋ', units)).toBe('ˈdɑɹ.lɪŋ');
  });

  it('does not write a separator next to a stress mark', () => {
    // `əˈbaʊt` already shows the boundary; `ə.ˈbaʊt` would double-mark it.
    const units = [V('ə'), C('b'), D('aʊ'), C('t')];
    expect(insertSyllableMarks('əˈbaʊt', units)).toBeNull();
  });

  it('leaves a transcription that already has separators alone', () => {
    // Maximal onset would prefer `ˈmɛ.ʒɚ`; the source said `ˈmɛʒ.ɚ` and wins.
    const units = [C('m'), V('ɛ'), C('ʒ'), R('ɚ')];
    expect(insertSyllableMarks('ˈmɛʒ.ɚ', units)).toBeNull();
  });

  it('returns null for a monosyllable, which gains nothing', () => {
    expect(insertSyllableMarks('ˈkæt', [C('k'), V('æ'), C('t')])).toBeNull();
  });

  it('refuses a transcription it cannot align to the units', () => {
    const units = [C('d'), V('ɑ'), C('ɹ'), C('l'), V('ɪ'), C('ŋ')];
    // `ː` is not canonical (D4 §3.7), so alignment fails and nothing is written.
    expect(insertSyllableMarks('ˈdɑːɹlɪŋ', units)).toBeNull();
    expect(insertSyllableMarks('ˈdɑɹlɪŋz', units)).toBeNull();
  });

  it('keeps every unit and adds nothing but separators', () => {
    const units = [C('p'), V('ɑ'), C('s'), C('ə'), C('b'), V('ə'), C('l')];
    const withoutMarks = (s) => s.replace(/[.ˈˌ]/g, '');
    const result = insertSyllableMarks('ˈpɑsəbəl', [C('p'), V('ɑ'), C('s'), V('ə'), C('b'), V('ə'), C('l')]);
    expect(result).not.toBeNull();
    expect(withoutMarks(result)).toBe('pɑsəbəl');
    expect(units.length).toBeGreaterThan(0);
  });
});

describe('insertSyllableMarks — the source stress mark wins', () => {
  const C = (ipaSymbol) => ({ ipaSymbol, category: 'consonant' });
  const V = (ipaSymbol) => ({ ipaSymbol, category: 'vowel' });
  const R = (ipaSymbol) => ({ ipaSymbol, category: 'central rhotic' });
  const D = (ipaSymbol) => ({ ipaSymbol, category: 'diphthong' });

  it('does not divide a cluster the stress mark has already divided', () => {
    // A checked /ɪ/ would demand a coda, but `ˈ` states the syllable starts at
    // /k/. Writing both would give `ɹɪˈk.ɔɹd`, which marks one boundary twice.
    const units = [C('ɹ'), V('ɪ'), C('k'), V('ɔ'), C('ɹ'), C('d')];
    expect(insertSyllableMarks('ɹɪˈkɔɹd', units)).toBeNull();
  });

  it('still marks the gaps the stress mark says nothing about', () => {
    // `ˌ` fixes the /f/ boundary; the /l/ boundary is still ours to add.
    const units = [C('t'), V('ɛ'), C('l'), V('ə'), C('f'), D('oʊ'), C('n')];
    expect(insertSyllableMarks('ˈtɛləˌfoʊn', units)).toBe('ˈtɛl.əˌfoʊn');
  });

  it('closes a checked vowel and leaves a free one open', () => {
    expect(insertSyllableMarks('ˈlɛtɚ', [C('l'), V('ɛ'), C('t'), R('ɚ')])).toBe('ˈlɛt.ɚ');
    expect(insertSyllableMarks('ˈsɪti', [C('s'), V('ɪ'), C('t'), V('i')])).toBe('ˈsɪt.i');
    // /ɑ/ is not checked: `spa` ends on it, so an open syllable is fine.
    expect(insertSyllableMarks('ˈbɑtəl', [C('b'), V('ɑ'), C('t'), V('ə'), C('l')])).toBe('ˈbɑ.təl');
  });
});

describe('insertSyllableMarks — a post-vocalic /ɹ/ closes its syllable', () => {
  const C = (ipaSymbol) => ({ ipaSymbol, category: 'consonant' });
  const V = (ipaSymbol) => ({ ipaSymbol, category: 'vowel' });

  it('keeps /ɹ/ in the coda rather than opening the next syllable', () => {
    // D4 §3.4 makes vowel+R compositional, so nothing else stops maximal onset
    // handing the /ɹ/ forward. `ˈɔ.ɹəndʒ` is not how the word divides.
    const units = [V('ɔ'), C('ɹ'), V('ə'), C('n'), C('d'), C('ʒ')];
    expect(insertSyllableMarks('ˈɔɹəndʒ', units)).toBe('ˈɔɹ.əndʒ');
  });

  it('still allows /ɹ/ as an onset when a consonant precedes it', () => {
    // `ˈæd.ɹɛs`: the /ɹ/ follows /d/, not the vowel, so it opens the syllable.
    const units = [V('æ'), C('d'), C('ɹ'), V('ɛ'), C('s')];
    expect(insertSyllableMarks('ˈædɹɛs', units)).toBe('ˈæd.ɹɛs');
  });
});

describe('syllabify — a central rhotic after a vowel', () => {
  const C = (ipaSymbol) => ({ ipaSymbol, category: 'consonant' });
  const V = (ipaSymbol) => ({ ipaSymbol, category: 'vowel' });
  const D = (ipaSymbol) => ({ ipaSymbol, category: 'diphthong' });
  const R = (ipaSymbol) => ({ ipaSymbol, category: 'central rhotic' });

  it('does not split a vowel from a following /ɚ/', () => {
    // `where` is one syllable; `wɛ.ɚ` would teach two.
    expect(syllabify([C('w'), V('ɛ'), R('ɚ')])).toEqual([0]);
    expect(insertSyllableMarks('wɛɚ', [C('w'), V('ɛ'), R('ɚ')])).toBeNull();
    // `fire` is genuinely disputed, so it stays unmarked rather than asserted.
    expect(insertSyllableMarks('faɪɚ', [C('f'), D('aɪ'), R('ɚ')])).toBeNull();
  });

  it('still splits a genuine vowel hiatus', () => {
    expect(syllabify([C('k'), D('eɪ'), V('ɑ'), C('s')])).toEqual([0, 2]);
  });
});
