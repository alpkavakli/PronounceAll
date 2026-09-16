/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Curated syllabification regression set (FR-WORD-03, D4 §3.8).
 *
 * One case per phenomenon the algorithm has to get right, so a future change to
 * the onset table or the constraint order cannot quietly move a boundary a
 * learner reads. Each expectation is the division American pronunciation
 * dictionaries give, and the comment says which rule produces it.
 *
 * `insertSyllableMarks` is the function under test rather than `syllabify`,
 * because it is what reaches a page: it applies the boundaries AND the rule
 * that a source stress mark already marks one. `null` means "we write nothing
 * here", which is a real, intended outcome and not a gap in the set.
 */

import { describe, expect, it } from '@jest/globals';

import { insertSyllableMarks } from '../../src/services/syllabification.service.js';

const C = (ipaSymbol) => ({ ipaSymbol, category: 'consonant' });
const V = (ipaSymbol) => ({ ipaSymbol, category: 'vowel' });
const D = (ipaSymbol) => ({ ipaSymbol, category: 'diphthong' });
const R = (ipaSymbol) => ({ ipaSymbol, category: 'central rhotic' });

const units = (spec) =>
  spec.map(([symbol, kind]) => {
    if (kind === 'v') return V(symbol);
    if (kind === 'd') return D(symbol);
    if (kind === 'r') return R(symbol);
    return C(symbol);
  });

describe('checked vowels close their syllable', () => {
  it.each([
    ['letter', 'ˈlɛtɚ', [['l'], ['ɛ', 'v'], ['t'], ['ɚ', 'r']], 'ˈlɛt.ɚ'],
    ['city', 'ˈsɪti', [['s'], ['ɪ', 'v'], ['t'], ['i', 'v']], 'ˈsɪt.i'],
    ['happy', 'ˈhæpi', [['h'], ['æ', 'v'], ['p'], ['i', 'v']], 'ˈhæp.i'],
  ])('%s', (_word, transcription, spec, expected) => {
    expect(insertSyllableMarks(transcription, units(spec))).toBe(expected);
  });
});

describe('free vowels may end a syllable', () => {
  it.each([
    // `/ɑ/` and `/ɔ/` are not checked — `spa`, `law` — so maximal onset stands.
    ['bottle', 'ˈbɑtəl', [['b'], ['ɑ', 'v'], ['t'], ['ə', 'v'], ['l']], 'ˈbɑ.təl'],
    ['coffee', 'ˈkɔfi', [['k'], ['ɔ', 'v'], ['f'], ['i', 'v']], 'ˈkɔ.fi'],
  ])('%s', (_word, transcription, spec, expected) => {
    expect(insertSyllableMarks(transcription, units(spec))).toBe(expected);
  });
});

describe('a post-vocalic /ɹ/ stays with the vowel', () => {
  it.each([
    ['orange', 'ˈɔɹəndʒ', [['ɔ', 'v'], ['ɹ'], ['ə', 'v'], ['n'], ['dʒ']], 'ˈɔɹ.əndʒ'],
    ['hero', 'ˈhɪɹoʊ', [['h'], ['ɪ', 'v'], ['ɹ'], ['oʊ', 'd']], 'ˈhɪɹ.oʊ'],
    ['very', 'ˈvɛɹi', [['v'], ['ɛ', 'v'], ['ɹ'], ['i', 'v']], 'ˈvɛɹ.i'],
  ])('%s', (_word, transcription, spec, expected) => {
    expect(insertSyllableMarks(transcription, units(spec))).toBe(expected);
  });

  it('around — the stress mark already divides it, so nothing is written', () => {
    // `əˈɹaʊnd`. The /ɹ/ opens the stressed syllable here, which is the one
    // context the rhotic-coda rule gets wrong on its own; the stress mark
    // outranks it and the row is left exactly as the source wrote it.
    const spec = [['ə', 'v'], ['ɹ'], ['aʊ', 'd'], ['n'], ['d']];
    expect(insertSyllableMarks('əˈɹaʊnd', units(spec))).toBeNull();
  });
});

describe('genuine hiatus is divided, not treated as a defect', () => {
  it.each([
    ['doing', 'ˈduɪŋ', [['d'], ['u', 'v'], ['ɪ', 'v'], ['ŋ']], 'ˈdu.ɪŋ'],
    ['knowing', 'ˈnoʊɪŋ', [['n'], ['oʊ', 'd'], ['ɪ', 'v'], ['ŋ']], 'ˈnoʊ.ɪŋ'],
    ['chaos', 'ˈkeɪɑs', [['k'], ['eɪ', 'd'], ['ɑ', 'v'], ['s']], 'ˈkeɪ.ɑs'],
  ])('%s', (_word, transcription, spec, expected) => {
    expect(insertSyllableMarks(transcription, units(spec))).toBe(expected);
  });
});

describe('a vowel plus a central rhotic is left undivided', () => {
  it.each([
    ['where', 'wɛɚ', [['w'], ['ɛ', 'v'], ['ɚ', 'r']]],
    ['fire', 'ˈfaɪɚ', [['f'], ['aɪ', 'd'], ['ɚ', 'r']]],
  ])('%s', (_word, transcription, spec) => {
    // Heard as one syllable at least as often as two. Writing `wɛ.ɚ` would
    // teach a two-syllable `where` as fact.
    expect(insertSyllableMarks(transcription, units(spec))).toBeNull();
  });
});

describe('affricates and clusters', () => {
  it.each([
    // The affricate is ONE unit, so the boundary cannot fall inside it.
    ['kitchen', 'ˈkɪtʃən', [['k'], ['ɪ', 'v'], ['tʃ'], ['ə', 'v'], ['n']], 'ˈkɪtʃ.ən'],
    ['action', 'ˈækʃən', [['æ', 'v'], ['k'], ['ʃ'], ['ə', 'v'], ['n']], 'ˈæk.ʃən'],
    // `/dɹ/` is a legal onset and survives as one.
    ['children', 'ˈtʃɪldɹən', [['tʃ'], ['ɪ', 'v'], ['l'], ['d'], ['ɹ'], ['ə', 'v'], ['n']], 'ˈtʃɪl.dɹən'],
  ])('%s', (_word, transcription, spec, expected) => {
    expect(insertSyllableMarks(transcription, units(spec))).toBe(expected);
  });
});

describe('secondary stress', () => {
  it('telephone — the primary mark divides one gap, we divide the other', () => {
    const spec = [['t'], ['ɛ', 'v'], ['l'], ['ə', 'v'], ['f'], ['oʊ', 'd'], ['n']];
    expect(insertSyllableMarks('ˈtɛləˌfoʊn', units(spec))).toBe('ˈtɛl.əˌfoʊn');
  });

  it('somebody — both stress marks stand, and the last gap is ours', () => {
    const spec = [['s'], ['ʌ', 'v'], ['m'], ['b'], ['ɑ', 'v'], ['d'], ['i', 'v']];
    expect(insertSyllableMarks('ˈsʌmˌbɑdi', units(spec))).toBe('ˈsʌmˌbɑ.di');
  });
});

describe('a stress mark inside a cluster fixes that boundary', () => {
  // Maximal onset on the unstressed sequence would put the separator one unit
  // before the mark, leaving a consonant as a syllable with no nucleus:
  // `tɹæn.sˈfɚ`. The source's mark decides the gap instead.
  it.each([
    ['transfer', 'tɹænsˈfɚ', [['t'], ['ɹ'], ['æ', 'v'], ['n'], ['s'], ['f'], ['ɚ', 'r']], null],
    ['atmosphere', 'ˈætməsˌfɪɹ', [['æ', 'v'], ['t'], ['m'], ['ə', 'v'], ['s'], ['f'], ['ɪ', 'v'], ['ɹ']], 'ˈæt.məsˌfɪɹ'],
    ['software', 'ˈsɔftˌwɛɹ', [['s'], ['ɔ', 'v'], ['f'], ['t'], ['w'], ['ɛ', 'v'], ['ɹ']], null],
    ['graveyard', 'ˈɡɹeɪvˌjɑɹd', [['ɡ'], ['ɹ'], ['eɪ', 'd'], ['v'], ['j'], ['ɑ', 'v'], ['ɹ'], ['d']], null],
    [
      'transmission',
      'tɹænsˈmɪʃən',
      [['t'], ['ɹ'], ['æ', 'v'], ['n'], ['s'], ['m'], ['ɪ', 'v'], ['ʃ'], ['ə', 'v'], ['n']],
      'tɹænsˈmɪʃ.ən',
    ],
  ])('%s', (_word, transcription, spec, expected) => {
    expect(insertSyllableMarks(transcription, units(spec))).toBe(expected);
  });
});

describe('no syllable is ever written without a nucleus', () => {
  it('leaves a row unmarked when the source stress mark cannot begin a syllable', () => {
    // A mark before a consonant with no nucleus between it and the word start.
    const spec = [['s'], ['t'], ['ɑ', 'v'], ['p'], ['i', 'v']];
    expect(insertSyllableMarks('sˈtɑpi', units(spec))).toBeNull();
  });
});

describe('a boundary the source supplied is never re-divided', () => {
  it('measure keeps ˈmɛʒ.ɚ though maximal onset prefers ˈmɛ.ʒɚ', () => {
    const spec = [['m'], ['ɛ', 'v'], ['ʒ'], ['ɚ', 'r']];
    expect(insertSyllableMarks('ˈmɛʒ.ɚ', units(spec))).toBeNull();
  });
});
