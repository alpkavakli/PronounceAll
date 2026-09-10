/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The D4 §7 acceptance fixtures, run against the PRODUCTION tokenizer
 * (FR-IPA-01, FR-IPA-02, D4 §5).
 *
 * D4 §7 is not illustrative: it is the fixture suite the artifact requires this
 * implementation to pass before any phoneme relationship is loaded. Each case
 * below is one row of that table.
 *
 * The rejection half matters as much as the acceptance half. D4 §5.6 forbids
 * silent lossy coercion, so a transcription carrying a narrow or non-American
 * symbol must FAIL rather than be nudged to the nearest canonical unit — a
 * tokenizer that quietly mapped `[ɾ]` to `/t/` would satisfy every acceptance
 * case here and still be wrong.
 */

import { beforeAll, describe, expect, test } from '@jest/globals';

import {
  loadInventory,
  normaliseSource,
  PERMITTED_MARKS,
  tokenizeTranscription,
} from '../../src/services/ipa-tokenization.service.js';

/** @type {object} */
let inventory;

beforeAll(async () => {
  inventory = await loadInventory('en-us');
});

/** @param {string} raw @returns {object} */
function run(raw) {
  return tokenizeTranscription(raw, inventory);
}

/** @param {string} raw @returns {string[]} units of the first realisation */
function units(raw) {
  const result = run(raw);
  expect(result.ok).toBe(true);
  return result.forms[0].units;
}

describe('the canonical inventory artifact', () => {
  test('is the frozen 41-unit D4 inventory', () => {
    expect(inventory.units).toHaveLength(41);
    expect(new Set(inventory.symbols).size).toBe(41);
  });

  test('carries the three D4 categories at their frozen sizes', () => {
    const byCategory = {};
    for (const unit of inventory.units) {
      byCategory[unit.category] = (byCategory[unit.category] ?? 0) + 1;
    }
    expect(byCategory).toEqual({
      consonant: 24,
      vowel: 10,
      'central rhotic': 2,
      diphthong: 5,
    });
  });

  test('every unit carries a per-row source attribution (E2)', () => {
    for (const unit of inventory.units) {
      expect(unit.sourceReference).toMatch(/^https:\/\//);
      expect(unit.exampleWord).not.toBe('');
    }
  });
});

describe('D4 §7 — must tokenise', () => {
  test('pre-rhotic oɹ becomes ɔ + ɹ', () => {
    expect(units('ˈoɹənd͡ʒ')).toEqual(['ɔ', 'ɹ', 'ə', 'n', 'dʒ']);
  });

  test('the oɹ rule is source-profile-specific, not a global o -> ɔ', () => {
    // The single most important negative case for D4 §5.3.1: /oʊ/ is an atomic
    // diphthong and must survive a rule aimed only at the pre-rhotic vowel.
    expect(units('ˈkoʊld')).toEqual(['k', 'oʊ', 'l', 'd']);
  });

  test('ɚ is one unstressed r-coloured unit', () => {
    expect(units('ˈbʌtɚ')).toEqual(['b', 'ʌ', 't', 'ɚ']);
  });

  test('ɝ is one stressed r-coloured unit', () => {
    expect(units('ɝθ')).toEqual(['ɝ', 'θ']);
  });

  test('NURSE ɜɹ becomes ɝ', () => {
    expect(units('wɜɹd')).toEqual(['w', 'ɝ', 'd']);
  });

  test('əɹ becomes ɚ when the ɹ closes the syllable', () => {
    expect(units('ˈfɑ.ðəɹ')).toEqual(['f', 'ɑ', 'ð', 'ɚ']);
  });

  test('əɹ stays compositional when the ɹ is prevocalic', () => {
    // Without the guard this would corrupt to /kɚɛkt/.
    expect(units('kəɹɛkt')).toEqual(['k', 'ə', 'ɹ', 'ɛ', 'k', 't']);
  });

  test('ʌ and ə remain distinct units', () => {
    expect(units('əˈbʌv')).toEqual(['ə', 'b', 'ʌ', 'v']);
  });

  test('source r maps to canonical ɹ', () => {
    expect(units('ˈrɛkɔrd')).toEqual(['ɹ', 'ɛ', 'k', 'ɔ', 'ɹ', 'd']);
  });

  test('tied affricates are single units', () => {
    expect(units('t͡ʃɛɚ')).toEqual(['tʃ', 'ɛ', 'ɚ']);
    expect(units('d͡ʒʌmp')).toEqual(['dʒ', 'ʌ', 'm', 'p']);
  });

  test('stress marks are not occurrences', () => {
    expect(units('ˈkʌpˌkeɪk')).toEqual(['k', 'ʌ', 'p', 'k', 'eɪ', 'k']);
  });

  test('syllable separators are not occurrences', () => {
    expect(units('ˈoʊ.pən')).toEqual(['oʊ', 'p', 'ə', 'n']);
  });

  test('ɔ and ɑ are distinct', () => {
    expect(units('ˈɔ.θɚ')).toContain('ɔ');
    expect(units('ˈɑtɚ')).toContain('ɑ');
  });

  test('length marks are dropped', () => {
    expect(units('fuːd')).toEqual(['f', 'u', 'd']);
  });

  test('the non-syllabic offglide mark is dropped', () => {
    expect(units('ˈaʊ̯t')).toEqual(['aʊ', 't']);
  });

  test('vowel plus R is compositional — two clickable units', () => {
    expect(units('kɑɹ')).toEqual(['k', 'ɑ', 'ɹ']);
  });

  test('a diphthong is atomic — one clickable unit', () => {
    expect(units('aɪs')).toEqual(['aɪ', 's']);
  });

  test('a syllabic consonant becomes schwa plus that consonant', () => {
    expect(units('ˈhɑs.pɪ.tl̩')).toEqual(['h', 'ɑ', 's', 'p', 'ɪ', 't', 'ə', 'l']);
  });
});

describe('D4 §5.4 — parentheses are resolved, never persisted', () => {
  test('optional (ɹ) selects the rhotic realisation, yielding one form', () => {
    const result = run('ˈwɛðə(ɹ)');

    expect(result.ok).toBe(true);
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0].ipa).toBe('ˈwɛðɚ');
    expect(result.forms[0].units).toEqual(['w', 'ɛ', 'ð', 'ɚ']);
  });

  test('another optional segment expands into both realisations', () => {
    const result = run('ˈfæm(ə)li');

    expect(result.ok).toBe(true);
    expect(result.forms.map((form) => form.ipa).sort()).toEqual(['ˈfæmli', 'ˈfæməli']);
  });

  test('no canonical form ever contains a parenthesis', () => {
    for (const raw of ['ˈwɛðə(ɹ)', 'ˈfæm(ə)li', 'kloʊ(ð)z', 'ˈtʃɔk.(ə.)lɪt']) {
      const result = run(raw);
      expect(result.ok).toBe(true);
      for (const form of result.forms) {
        expect(form.ipa).not.toMatch(/[()]/);
      }
    }
  });

  test('an expansion is rejected as a whole when either realisation fails', () => {
    // The optional segment is fine; the flap is not. Keeping the half that
    // tokenised would silently drop an upstream claim.
    const result = run('ˈbɑɾ(ə)l');

    expect(result.ok).toBe(false);
    expect(result.offending).toBe('ɾ');
  });
});

describe('D4 §5.6 — fail closed, no lossy coercion', () => {
  test.each([
    ['a flap allophone', 'ˈbɑɾɫ̩', 'ɾ'],
    ['the RP vowel ɒ', 'dɒɡ', 'ɒ'],
    ['a glottal stop', 'hæʔ', 'ʔ'],
    ['RP ɜː outside a pre-rhotic context', 'ˈɜːli', 'ɜ'],
    ['a voiced-t diacritic', 'ˈdɔ.t̬ɚ', '̬'],
    ['an upstream bilabial-trill typo', 'ʙɹɪŋ', 'ʙ'],
  ])('rejects %s and names the offending character', (_label, raw, offending) => {
    const result = run(raw);

    expect(result.ok).toBe(false);
    expect(result.offending).toBe(offending);
  });

  test('rejection reports rather than coercing to a neighbouring unit', () => {
    const result = run('ˈbɑɾɫ̩');

    expect(result.ok).toBe(false);
    // The tell-tale of coercion would be a returned unit sequence.
    expect(result.forms).toBeUndefined();
  });

  test('the inventory is never expanded to accommodate a source', () => {
    run('dɒɡ');
    expect(inventory.symbols).toHaveLength(41);
    expect(inventory.symbols).not.toContain('ɒ');
  });
});

describe('permitted marks', () => {
  test('are exactly the three of D4 §5.5', () => {
    expect([...PERMITTED_MARKS].sort()).toEqual(['.', 'ˈ', 'ˌ']);
  });

  test('do not include parentheses', () => {
    expect(PERMITTED_MARKS.has('(')).toBe(false);
    expect(PERMITTED_MARKS.has(')')).toBe(false);
  });
});

describe('normalisation reporting', () => {
  test('every rewrite is reported, so a seed diff is reviewable', () => {
    const { forms, notes } = normaliseSource('t͡ʃiːz');

    expect(forms).toEqual(['tʃiz']);
    expect(notes).toEqual(
      expect.arrayContaining(['tie bar removed', 'length mark dropped']),
    );
  });

  test('a transcription needing no rewrite reports nothing', () => {
    expect(normaliseSource('kæt').notes).toEqual([]);
  });
});
