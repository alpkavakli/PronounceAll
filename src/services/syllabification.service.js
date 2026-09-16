/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Syllable boundaries for canonical en-us transcriptions (FR-WORD-03,
 * FR-IPA-01, D4 §3.8).
 *
 * D4 permits `.` as a non-clickable mark but does not say where a boundary
 * falls, because the sources it ingests are inconsistent about supplying one:
 * 1 898 of 7 531 seeded pronunciations carry a dot and the rest do not. This
 * module supplies the missing ones so a learner sees `/ˈdɑɹ.lɪŋ/` rather than
 * `/ˈdɑɹlɪŋ/`.
 *
 * Three rules keep it from becoming a second source of truth:
 *
 *   - **It only fills gaps.** A transcription that already carries a separator
 *     is returned untouched, even where this algorithm would divide it
 *     differently. `measure` is stored as `ˈmɛʒ.ɚ`; maximal onset would prefer
 *     `ˈmɛ.ʒɚ`. The source made a defensible call and overruling it silently
 *     would be exactly the lossy coercion D4 §5 forbids.
 *   - **It reads the decided unit sequence, never the IPA string.** Input is
 *     the canonical units already tokenised at seed time, so no symbol is
 *     identified here and the inventory is never extended.
 *   - **It fails closed.** A cluster it cannot divide legally yields no
 *     boundary at all rather than a guessed one.
 *
 * It runs at SEED TIME, like tokenisation, and for the same reason: browser
 * JavaScript never performs linguistic analysis on IPA (root `CLAUDE.md`).
 */

/** Categories in the D4 artifact that can be a syllable nucleus. */
export const NUCLEUS_CATEGORIES = new Set(['vowel', 'central rhotic', 'diphthong']);

/**
 * Onset clusters English permits word-initially, which is the standard test for
 * whether a medial cluster may open the following syllable.
 *
 * The list is deliberately conservative: a cluster absent here is treated as
 * illegal, which moves the boundary LEFT and produces a heavier coda. That is
 * the safe direction — it never invents an onset English does not use.
 *
 * `/ŋ/` is absent as a single onset because it cannot begin an English
 * syllable; every other canonical consonant can.
 */
const TWO_CONSONANT_ONSETS = new Set([
  // stop or fricative + liquid
  'pl', 'pɹ', 'bl', 'bɹ', 'tɹ', 'dɹ', 'kl', 'kɹ', 'ɡl', 'ɡɹ',
  'fl', 'fɹ', 'θɹ', 'ʃɹ', 'vɹ',
  // consonant + glide
  'pj', 'bj', 'tw', 'dw', 'kw', 'ɡw', 'kj', 'fj', 'vj', 'mj', 'nj', 'hj', 'lj', 'sj', 'θj',
  // /s/ + stop, nasal, liquid or glide
  'sp', 'st', 'sk', 'sl', 'sm', 'sn', 'sw', 'sf',
  // /ʃ/ clusters, chiefly in borrowings but productive in en-us
  'ʃm', 'ʃl', 'ʃn', 'ʃp', 'ʃt', 'ʃv',
]);

const THREE_CONSONANT_ONSETS = new Set(['spl', 'spɹ', 'spj', 'stɹ', 'stj', 'skɹ', 'skw', 'skj']);

/**
 * The checked (lax) vowels, which cannot end a syllable in English.
 *
 * Maximal onset alone would divide `letter` as `ˈlɛ.tɚ` and `city` as `ˈsɪ.ti`,
 * but English does not allow an open syllable on a lax vowel: the nucleus must
 * be closed by at least one consonant, which is why pronunciation dictionaries
 * write `ˈlɛt.ɚ` and `ˈsɪt.i`. `/ɑ/` and `/ɔ/` are NOT checked in en-us — `spa`
 * and `law` end on them — so `ˈbɑ.təl` is correct and stays.
 *
 * `/ə/` is absent because it is inherently unstressed and freely open
 * (`ˈfæm.ə.li`).
 */
const CHECKED_VOWELS = new Set(['ɪ', 'ɛ', 'æ', 'ʌ', 'ʊ']);

/** A consonant that cannot open a syllable on its own. */
const ILLEGAL_SINGLE_ONSET = new Set(['ŋ']);

/**
 * Is this run of consonants a legal syllable onset?
 *
 * @param {string[]} cluster consonant symbols, in order
 * @returns {boolean}
 */
export function isLegalOnset(cluster) {
  if (cluster.length === 0) return true;
  if (cluster.length === 1) return !ILLEGAL_SINGLE_ONSET.has(cluster[0]);
  if (cluster.length === 2) return TWO_CONSONANT_ONSETS.has(cluster.join(''));
  if (cluster.length === 3) return THREE_CONSONANT_ONSETS.has(cluster.join(''));
  return false;
}

/**
 * Divide a tokenised word into syllables by the maximal onset principle.
 *
 * Every syllable is built around one nucleus. The consonants between two
 * nuclei are split so the following syllable takes the LONGEST legal onset it
 * can, and whatever remains closes the preceding syllable — the division
 * English speakers and pronunciation dictionaries both tend to prefer.
 *
 * @param {Array<{ipaSymbol: string, category: string}>} units ordered canonical units
 * @returns {number[]} indices in `units` that begin a syllable, ascending, always starting at 0
 */
export function syllabify(units) {
  if (!Array.isArray(units) || units.length === 0) return [];

  const nuclei = [];
  units.forEach((unit, index) => {
    if (NUCLEUS_CATEGORIES.has(unit.category)) nuclei.push(index);
  });

  // No nucleus means no syllable structure this module can describe — an
  // abbreviation spelled out, or a unit sequence that never should have been
  // stored. One syllable, no internal boundary.
  if (nuclei.length <= 1) return [0];

  const starts = [0];

  for (let n = 0; n < nuclei.length - 1; n += 1) {
    const cluster = units.slice(nuclei[n] + 1, nuclei[n + 1]).map((unit) => unit.ipaSymbol);

    // Hiatus: two nuclei in a row, so the boundary sits between them —
    // `ˈkeɪ.ɑs`.
    if (cluster.length === 0) {
      // Except before a central rhotic, which an English speaker does not
      // reliably separate from the vowel it follows. `where` /wɛɚ/ and `fire`
      // /faɪɚ/ are heard as one syllable at least as often as two, so the
      // division is genuinely disputed rather than merely unknown. Writing
      // `wɛ.ɚ` would teach a two-syllable `where` as fact; leaving it unmarked
      // teaches nothing false.
      if (units[nuclei[n + 1]].category !== 'central rhotic') starts.push(nuclei[n + 1]);
      continue;
    }

    // Longest legal onset wins; `take` counts consonants given to the NEXT
    // syllable. A single intervocalic consonant therefore opens it (`wɔ.tɚ`).
    //
    // A checked vowel overrides that: it must keep a coda, so the onset may
    // claim at most all but one of the cluster. With a single consonant
    // between a checked vowel and the next nucleus the onset gets nothing and
    // the consonant closes the first syllable — `ˈlɛt.ɚ`, not `ˈlɛ.tɚ`.
    let maximumOnset = CHECKED_VOWELS.has(units[nuclei[n]].ipaSymbol)
      ? cluster.length - 1
      : cluster.length;

    // A post-vocalic /ɹ/ belongs to the syllable it follows. D4 §3.4 makes
    // vowel-plus-R compositional rather than one unit, so nothing else stops
    // maximal onset from handing the /ɹ/ forward and rendering `ˈɔ.ɹəndʒ`,
    // where every pronunciation dictionary closes the syllable: `ˈɔɹ.əndʒ`.
    if (cluster[0] === 'ɹ') maximumOnset = Math.min(maximumOnset, cluster.length - 1);

    let take = 0;
    for (let size = Math.min(3, maximumOnset); size >= 1; size -= 1) {
      if (isLegalOnset(cluster.slice(cluster.length - size))) {
        take = size;
        break;
      }
    }

    starts.push(nuclei[n + 1] - take);
  }

  return starts;
}

/**
 * Write the separators into a stored transcription.
 *
 * The transcription is walked against the same decided unit sequence the word
 * page uses, so a `.` lands exactly where the unit boundary is rather than at a
 * character offset guessed from the string.
 *
 * A stress mark already marks a boundary — `/əˈbaʊt/`, never `/ə.ˈbaʊt/` — so a
 * separator is suppressed where one sits.
 *
 * @param {string} transcription stored IPA, without slashes
 * @param {Array<{ipaSymbol: string, category: string}>} units ordered canonical units
 * @returns {string|null} the transcription with separators, or null if it could
 *   not be aligned, already carries a separator, or gained nothing
 */
export function insertSyllableMarks(transcription, units) {
  if (typeof transcription !== 'string' || transcription.length === 0) return null;
  if (transcription.includes('.')) return null;
  if (!Array.isArray(units) || units.length === 0) return null;

  const starts = new Set(syllabify(units).slice(1));
  if (starts.size === 0) return null;

  const STRESS = new Set(['ˈ', 'ˌ']);
  let out = '';
  let cursor = 0;
  let next = 0;
  // A stress mark IS a syllable boundary, and the source placed it. Where one
  // falls inside a cluster, it states where that syllable begins and overrides
  // the computed division for that gap entirely — `ɹɪˈkɔɹd`, never
  // `ɹɪˈk.ɔɹd`, even though a checked `/ɪ/` would otherwise demand the coda.
  let stressSinceNucleus = false;

  while (cursor < transcription.length) {
    const unit = units[next];

    if (unit && transcription.startsWith(unit.ipaSymbol, cursor)) {
      if (starts.has(next) && !stressSinceNucleus) out += '.';
      out += unit.ipaSymbol;
      if (NUCLEUS_CATEGORIES.has(unit.category)) stressSinceNucleus = false;
      cursor += unit.ipaSymbol.length;
      next += 1;
      continue;
    }

    if (STRESS.has(transcription[cursor])) {
      out += transcription[cursor];
      stressSinceNucleus = true;
      cursor += 1;
      continue;
    }

    return null;
  }

  if (next !== units.length) return null;
  return out === transcription ? null : out;
}
