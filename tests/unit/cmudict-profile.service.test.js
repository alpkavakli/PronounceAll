/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The CMUdict source profile (D4 §5.8).
 *
 * A curated CMUdict row claims CMUdict as its source, so the curated form must
 * say exactly what the pinned entry says. These cases pin the refusals — wrong
 * unit, wrong stress, an undecided double primary — beside the forms that pass.
 */

import { describe, expect, it } from '@jest/globals';

import { mapPhone, verifyCmudictForm } from '../../src/services/cmudict-profile.service.js';

const verify = (form, units, arpabet, stressDecision) =>
  verifyCmudictForm({ form, units, variants: [arpabet], stressDecision });

describe('mapPhone', () => {
  it('splits AH and ER by stress, as D4 keeps ʌ/ə and ɝ/ɚ distinct', () => {
    expect(mapPhone('AH0')).toEqual({ unit: 'ə', stress: 0 });
    expect(mapPhone('AH1')).toEqual({ unit: 'ʌ', stress: 1 });
    expect(mapPhone('ER0')).toEqual({ unit: 'ɚ', stress: 0 });
    expect(mapPhone('ER2')).toEqual({ unit: 'ɝ', stress: 2 });
  });

  it('refuses a vowel without a stress digit and an unknown phone', () => {
    expect(mapPhone('OW')).toBeNull();
    expect(mapPhone('XX1')).toBeNull();
  });
});

describe('verifyCmudictForm', () => {
  it('accepts a form that matches unit for unit and stress for stress', () => {
    expect(verify('ˈtoʊni', ['t', 'oʊ', 'n', 'i'], 'T OW1 N IY0')).toEqual({ ok: true, arpabet: 'T OW1 N IY0' });
    expect(verify('ˈhɔɹˌmoʊnz', ['h', 'ɔ', 'ɹ', 'm', 'oʊ', 'n', 'z'], 'HH AO1 R M OW2 N Z').ok).toBe(true);
    expect(verify('əˈpoʊnənt', ['ə', 'p', 'oʊ', 'n', 'ə', 'n', 't'], 'AH0 P OW1 N AH0 N T').ok).toBe(true);
  });

  it('refuses a form whose units differ from the entry', () => {
    // Wiktionary's `-sɪs` is not what CMUdict says (`S AH0 S`).
    const result = verify(
      'ˌdaɪəɡˈnoʊsɪs',
      ['d', 'aɪ', 'ə', 'ɡ', 'n', 'oʊ', 's', 'ɪ', 's'],
      'D AY2 AH0 G N OW1 S AH0 S',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/units/);
  });

  it('refuses a form whose stress marks differ from the entry', () => {
    expect(verify('ˈhɔɹmoʊnz', ['h', 'ɔ', 'ɹ', 'm', 'oʊ', 'n', 'z'], 'HH AO1 R M OW2 N Z').ok).toBe(false);
    expect(verify('toʊni', ['t', 'oʊ', 'n', 'i'], 'T OW1 N IY0').ok).toBe(false);
  });

  describe('two primary stresses — no global rule', () => {
    const units = ['oʊ', 'v', 'ɚ', 'n', 'aɪ', 't'];
    const arpabet = 'OW1 V ER0 N AY1 T';

    it('refuses without a curated stress decision', () => {
      const result = verify('ˌoʊvɚˈnaɪt', units, arpabet);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/stressDecision/);
    });

    it('accepts either resolution once the maintainer has decided it', () => {
      expect(verify('ˌoʊvɚˈnaɪt', units, arpabet, 'main stress on -night').ok).toBe(true);
      expect(verify('ˈoʊvɚˌnaɪt', units, arpabet, 'main stress on over-').ok).toBe(true);
    });

    it('still refuses a decision that keeps two primaries or none', () => {
      expect(verify('ˈoʊvɚˈnaɪt', units, arpabet, 'both').ok).toBe(false);
      expect(verify('ˌoʊvɚˌnaɪt', units, arpabet, 'neither').ok).toBe(false);
    });
  });

  it('refuses a headword the pinned artifact does not hold', () => {
    expect(verifyCmudictForm({ form: 'ˈtoʊl', units: ['t', 'oʊ', 'l'], variants: [] }).ok).toBe(false);
  });
});
