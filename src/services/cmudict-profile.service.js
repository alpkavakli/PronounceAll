/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The CMU Pronouncing Dictionary source profile (D4 §5.8, E1).
 *
 * CMUdict is a second pronunciation source admitted ONLY through curation, for
 * a word whose Wiktionary entry carries no usable General American form. The
 * maintainer writes the canonical IPA; this module verifies that the written
 * form is exactly what the pinned CMUdict entry says, so a curated row can
 * truthfully claim CMUdict as its source. Nothing here converts ARPABET into
 * IPA on its own — a verifier cannot invent a transcription.
 *
 * Verification is unit-for-unit and stress-for-stress:
 *
 *   - each ARPABET phone maps to exactly one canonical unit. `AH` and `ER`
 *     split by stress, because D4 §3.2–3.3 keep `/ʌ/`–`/ə/` and `/ɝ/`–`/ɚ/`
 *     distinct and CMUdict encodes that distinction as the stress digit;
 *   - each vowel's stress digit must match the mark the curated form places
 *     before that vowel's syllable: 1 → `ˈ`, 2 → `ˌ`, 0 → none.
 *
 * An entry with more than one primary stress (`overnight` is `OW1 … AY1`)
 * cannot be written with a single `ˈ` without choosing between them. No rule
 * makes that choice: the pin must carry an explicit `stressDecision`, and the
 * form must then mark every digit-1 vowel with `ˈ` or `ˌ`, exactly one of them
 * `ˈ`.
 */

const CONSONANTS = {
  P: 'p', B: 'b', T: 't', D: 'd', K: 'k', G: 'ɡ', CH: 'tʃ', JH: 'dʒ',
  F: 'f', V: 'v', TH: 'θ', DH: 'ð', S: 's', Z: 'z', SH: 'ʃ', ZH: 'ʒ',
  HH: 'h', M: 'm', N: 'n', NG: 'ŋ', L: 'l', R: 'ɹ', W: 'w', Y: 'j',
};

const VOWELS = {
  AA: 'ɑ', AE: 'æ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', EY: 'eɪ',
  IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
};

const STRESS_MARK = { 1: 'ˈ', 2: 'ˌ', 0: '' };

/**
 * One ARPABET phone as a canonical unit, or null if the profile has no mapping.
 *
 * @param {string} phone e.g. `OW1`, `AH0`, `N`
 * @returns {{unit: string, stress: number|null}|null}
 */
export function mapPhone(phone) {
  const match = /^([A-Z]+)([012])?$/.exec(phone);
  if (!match) return null;
  const [, base, digit] = match;
  if (CONSONANTS[base] && digit === undefined) return { unit: CONSONANTS[base], stress: null };
  if (digit === undefined) return null;
  const stress = Number(digit);
  if (base === 'AH') return { unit: stress === 0 ? 'ə' : 'ʌ', stress };
  if (base === 'ER') return { unit: stress === 0 ? 'ɚ' : 'ɝ', stress };
  if (VOWELS[base]) return { unit: VOWELS[base], stress };
  return null;
}

/**
 * The stress mark written before each vowel of a canonical form.
 *
 * A mark belongs to the next vowel after it, wherever it falls in the cluster,
 * so `ˈhɔɹˌmoʊnz` gives `ˈ` to `/ɔ/` and `ˌ` to `/oʊ/`.
 *
 * @param {string} form canonical IPA without slashes
 * @param {string[]} units its tokenised units, in order
 * @param {Set<string>} vowelUnits units that are syllable nuclei
 * @returns {string[]|null} one mark ('' for none) per vowel, or null if unalignable
 */
function marksPerVowel(form, units, vowelUnits) {
  const marks = [];
  let pending = '';
  let cursor = 0;
  for (const unit of units) {
    while (form[cursor] === 'ˈ' || form[cursor] === 'ˌ' || form[cursor] === '.') {
      if (form[cursor] !== '.') pending = form[cursor];
      cursor += 1;
    }
    if (!form.startsWith(unit, cursor)) return null;
    cursor += unit.length;
    if (vowelUnits.has(unit)) {
      marks.push(pending);
      pending = '';
    }
  }
  return cursor === form.length ? marks : null;
}

/**
 * Verify a curated canonical form against the pinned CMUdict entry.
 *
 * @param {object} input
 * @param {string} input.form the curated canonical IPA, without slashes
 * @param {string[]} input.units its tokenised canonical units
 * @param {string[]} input.variants the entry's ARPABET pronunciations, e.g. `['T OW1 L']`
 * @param {string} [input.stressDecision] the maintainer's reason, required for multiple primaries
 * @returns {{ok: true, arpabet: string}|{ok: false, reason: string}}
 */
export function verifyCmudictForm({ form, units, variants, stressDecision }) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { ok: false, reason: 'no entry in the pinned CMUdict artifact' };
  }

  const reasons = [];
  for (const arpabet of variants) {
    const phones = arpabet.trim().split(/\s+/).map(mapPhone);
    if (phones.includes(null)) {
      reasons.push(`${arpabet}: a phone has no mapping in the CMUdict profile`);
      continue;
    }

    const expectedUnits = phones.map((phone) => phone.unit);
    if (expectedUnits.length !== units.length || expectedUnits.some((unit, i) => unit !== units[i])) {
      reasons.push(`${arpabet}: units ${expectedUnits.join(' ')} differ from ${units.join(' ')}`);
      continue;
    }

    const stresses = phones.filter((phone) => phone.stress !== null).map((phone) => phone.stress);
    const vowelUnits = new Set(phones.filter((phone) => phone.stress !== null).map((phone) => phone.unit));
    const marks = marksPerVowel(form, units, vowelUnits);
    if (!marks || marks.length !== stresses.length) {
      reasons.push(`${arpabet}: the stress marks do not align with the vowels`);
      continue;
    }

    const primaries = stresses.filter((stress) => stress === 1).length;
    if (primaries > 1) {
      if (!stressDecision) {
        reasons.push(`${arpabet}: ${primaries} primary stresses require a curated stressDecision`);
        continue;
      }
      const decided = stresses.every((stress, i) =>
        stress === 1 ? marks[i] === 'ˈ' || marks[i] === 'ˌ' : marks[i] === STRESS_MARK[stress],
      );
      if (decided && marks.filter((mark) => mark === 'ˈ').length === 1) return { ok: true, arpabet };
      reasons.push(`${arpabet}: the curated stress decision must keep exactly one ˈ among the primaries`);
      continue;
    }

    if (stresses.every((stress, i) => marks[i] === STRESS_MARK[stress])) return { ok: true, arpabet };
    reasons.push(`${arpabet}: stress marks ${marks.map((mark) => mark || '∅').join(' ')} differ from ${stresses.join(' ')}`);
  }

  return { ok: false, reason: reasons.join('; ') };
}
