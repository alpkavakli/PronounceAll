/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Canonical IPA normalisation and tokenisation (D4, FR-IPA-01, FR-IPA-02, E1).
 *
 * This is the production implementation of the policy frozen in D4
 * (`docs/current/PronounceAll_en-US_Phoneme_Inventory_v1.md`) §5. D4 is the
 * authority; this module implements it and must not extend it.
 *
 * It runs at SEED TIME only. `pronunciation_phonemes` stores the resulting
 * ordered occurrences, so the render path performs an indexed join rather than
 * reparsing IPA, and browser JavaScript never linguistically parses an IPA
 * string — a root `CLAUDE.md` invariant and the reason this lives server-side.
 *
 * Two hard rules from D4 shape the whole module:
 *
 *   - **Fail closed.** A transcription carrying anything the canonical
 *     inventory cannot represent is REJECTED and reported, never coerced to the
 *     nearest unit. The inventory is never expanded to accommodate a source.
 *   - **Source-profile rules only.** Every rewrite belongs to a named source
 *     profile and is documented in D4 §5.2. There is no generic "clean up the
 *     IPA" step, because that is exactly how silent lossy coercion creeps in.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'data', 'seed');

/** See `word-frequency.service.js` for why a composed path is validated. */
const VARIANT_CODE = /^[a-z0-9-]{2,12}$/;

/**
 * Permitted non-clickable marks (D4 §5.5): primary stress, secondary stress,
 * and the syllable separator. They are preserved for display and are NEVER
 * `pronunciation_phonemes` rows.
 *
 * Parentheses are deliberately absent. They are source notation encoding
 * optionality, are resolved by {@link normaliseSource}, and must never reach a
 * canonical transcription (D4 §5.4).
 */
export const PERMITTED_MARKS = Object.freeze(new Set(['ˈ', 'ˌ', '.']));

/**
 * Vowel-ish characters, including source notations, used only by the rhotic
 * guard below. It is deliberately generous: a character it fails to list makes
 * the guard MORE conservative, never less.
 */
const VOWELISH = 'iɪɛæʌəɑɔʊuɝɚeaoɜɒɐʉø';

/** @type {Map<string, Promise<object>>} variant code to loaded inventory */
const inventoryCache = new Map();

/**
 * Load the canonical inventory artifact for a variant.
 *
 * The artifact is derived from D4 by `scripts/extract-phoneme-inventory.js`, so
 * the symbol set has exactly one source of truth. E1 makes variant a data
 * dimension: adding `en-gb` adds an artifact, not a code branch.
 *
 * @param {string} variantCode
 * @returns {Promise<{units: object[], symbols: string[], maxLength: number}>}
 */
export function loadInventory(variantCode) {
  let pending = inventoryCache.get(variantCode);
  if (pending === undefined) {
    pending = (async () => {
      if (!VARIANT_CODE.test(variantCode)) {
        throw new Error(`Malformed variant code: ${variantCode}`);
      }
      const file = path.join(seedDir, `${variantCode}.phonemes.json`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const artifact = JSON.parse(await fs.readFile(file, 'utf8'));
      const symbols = artifact.units.map((unit) => unit.ipaSymbol);
      return {
        units: artifact.units,
        symbols,
        // Longest-match needs to know how far to look ahead. Derived rather
        // than hard-coded at 2, so a later variant with a three-character
        // teaching unit needs no code change.
        maxLength: Math.max(...symbols.map((symbol) => symbol.length)),
      };
    })();
    inventoryCache.set(variantCode, pending);
  }
  return pending;
}

/** Drop the cached inventory. Used by tests and after a re-extract. */
export function invalidateInventory(variantCode) {
  if (variantCode === undefined) {
    inventoryCache.clear();
    return;
  }
  inventoryCache.delete(variantCode);
}

/**
 * The two rhotic merges of D4 §5.2, as literal patterns.
 *
 * Each applies only where the `/ɹ/` is NOT prevocalic: `ˈfɑ.ðəɹ` becomes
 * `ˈfɑ.ðɚ` because the `/ɹ/` closes the syllable, but `kəɹɛkt` keeps a
 * compositional `/ə/` + `/ɹ/` because the `/ɹ/` is an onset. Without that guard
 * the merge would corrupt every word whose `/ɹ/` begins the following syllable.
 *
 * Written out rather than built from a template so the patterns are literal and
 * auditable — a constructed `RegExp` here would be one refactor away from
 * accepting a caller-supplied fragment.
 */
const RHOTIC_MERGES = Object.freeze([
  { pattern: new RegExp(`ɜɹ(?![${VOWELISH}])`, 'g'), to: 'ɝ', label: 'ɜɹ -> ɝ (stressed NURSE)' },
  { pattern: new RegExp(`əɹ(?![${VOWELISH}])`, 'g'), to: 'ɚ', label: 'əɹ -> ɚ (unstressed rhotic schwa)' },
]);

/**
 * @param {string} input
 * @param {string[]} notes
 * @returns {string}
 */
function applyRhoticMerges(input, notes) {
  let out = input;
  for (const { pattern, to, label } of RHOTIC_MERGES) {
    // `pattern` is global, so reset before reuse across calls.
    pattern.lastIndex = 0;
    if (pattern.test(out)) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, to);
      notes.push(label);
    }
  }
  return out;
}

/**
 * Expand the optional segments a source profile marks with parentheses.
 *
 * Optional `(ɹ)` is resolved before this runs: en-US is rhotic, so the rhotic
 * realisation is selected rather than branched on. Any OTHER optional segment
 * yields both realisations, which ingestion may store as separate
 * `word_pronunciations` rows provided each tokenises (D4 §5.4).
 *
 * @param {string} input
 * @returns {string[]}
 */
function expandOptionalSegments(input) {
  let forms = [input];
  // Bounded: a source transcription with more than a couple of optional groups
  // is malformed rather than interesting, and the caller fails it closed.
  for (let guard = 0; guard < 4 && forms.some((form) => form.includes('(')); guard += 1) {
    const next = [];
    for (const form of forms) {
      const match = /\(([^)]*)\)/.exec(form);
      if (!match) {
        next.push(form);
        continue;
      }
      const before = form.slice(0, match.index);
      const after = form.slice(match.index + match[0].length);
      next.push(before + match[1] + after);
      next.push(before + after);
    }
    forms = next;
  }
  return [...new Set(forms)];
}

/**
 * Apply the English Wiktionary en-US source profile (D4 §5.2, §5.3, §5.4).
 *
 * @param {string} raw a source transcription, without surrounding slashes
 * @returns {{forms: string[], notes: string[]}} one or more canonical forms
 */
export function normaliseSource(raw) {
  const notes = [];
  let value = raw.normalize('NFC');

  const rewrite = (pattern, replacement, label) => {
    if (pattern.test(value)) {
      value = value.replace(pattern, replacement);
      notes.push(label);
    }
  };

  rewrite(/͡/g, '', 'tie bar removed');
  rewrite(/g/g, 'ɡ', 'LATIN SMALL LETTER G -> IPA script g');
  rewrite(/r/g, 'ɹ', 'source r -> ɹ');
  rewrite(/ː/g, '', 'length mark dropped');
  rewrite(/̯/g, '', 'non-syllabic offglide mark dropped');
  // A syllabic consonant is schwa plus that consonant in this broad pedagogical
  // convention (D4 §5.3.2) — not a claim about the surface realisation.
  rewrite(/([lmnɫ])̩/g, 'ə$1', 'syllabic consonant -> ə + C');
  // en-US is rhotic, so an optional /ɹ/ resolves to the rhotic realisation
  // rather than branching (D4 §5.4).
  rewrite(/\(ɹ\)/g, 'ɹ', 'optional (ɹ) -> rhotic realisation');

  const forms = expandOptionalSegments(value);
  if (forms.length > 1) {
    notes.push(`optional segment expanded into ${forms.length} realisations`);
  }

  const canonical = forms.map((form) => {
    let out = applyRhoticMerges(form, notes);
    // Source-profile-specific FORCE/NORTH rule. NOT a global /o/ -> /ɔ/
    // substitution: `ˈkoʊld` is untouched (D4 §5.3.1).
    if (/o(?!ʊ)ɹ/.test(out)) {
      out = out.replace(/o(?!ʊ)ɹ/g, 'ɔɹ');
      notes.push('pre-rhotic oɹ -> ɔɹ');
    }
    return out;
  });

  return { forms: [...new Set(canonical)], notes: [...new Set(notes)] };
}

/**
 * Longest-match tokenise ONE already-normalised form.
 *
 * @param {string} form
 * @param {{symbols: string[], maxLength: number}} inventory
 * @returns {{ok: boolean, units: string[], offending?: string, offset?: number}}
 */
export function tokenizeForm(form, inventory) {
  const units = [];

  for (let index = 0; index < form.length; ) {
    if (PERMITTED_MARKS.has(form[index])) {
      index += 1;
      continue;
    }

    let matched = null;
    for (let width = Math.min(inventory.maxLength, form.length - index); width >= 1; width -= 1) {
      const candidate = form.slice(index, index + width);
      if (inventory.symbols.includes(candidate)) {
        matched = candidate;
        break;
      }
    }

    if (matched === null) {
      // Unmatched residue. Fail closed (D4 §5.6): report, never coerce.
      return { ok: false, units, offending: form[index], offset: index };
    }

    units.push(matched);
    index += matched.length;
  }

  return { ok: true, units };
}

/**
 * Normalise and tokenise one source transcription.
 *
 * Fails closed as a whole: if ANY expanded realisation fails to tokenise, the
 * source row is rejected rather than silently keeping the half that worked,
 * because the two realisations describe one source claim.
 *
 * @param {string} raw source transcription, without surrounding slashes
 * @param {{symbols: string[], maxLength: number}} inventory
 * @returns {{ok: boolean, notes: string[], forms?: Array<{ipa: string, units: string[]}>,
 *   offending?: string, failedForm?: string}}
 */
export function tokenizeTranscription(raw, inventory) {
  const { forms, notes } = normaliseSource(raw);

  const tokenised = [];
  for (const form of forms) {
    // A parenthesis surviving this far would mean optionality reached the
    // canonical string, which D4 §5.4 forbids outright.
    if (/[()]/.test(form)) {
      return { ok: false, notes, offending: '(', failedForm: form };
    }
    const result = tokenizeForm(form, inventory);
    if (!result.ok) {
      return { ok: false, notes, offending: result.offending, failedForm: form };
    }
    tokenised.push({ ipa: form, units: result.units });
  }

  return { ok: true, notes, forms: tokenised };
}

/**
 * Convenience wrapper that loads the inventory itself. Prefer passing a
 * preloaded inventory in a loop; this exists for callers handling one string.
 *
 * @param {string} raw
 * @param {string} variantCode
 * @returns {Promise<object>}
 */
export async function tokenize(raw, variantCode = 'en-us') {
  return tokenizeTranscription(raw, await loadInventory(variantCode));
}

export default tokenizeTranscription;
