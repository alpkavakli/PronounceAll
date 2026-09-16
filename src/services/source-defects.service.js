/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Pronunciations whose SOURCE form proves a source-profile defect (D4 §5,
 * FR-CONTENT-04).
 *
 * Adjacent vowel units alone prove nothing: `doing` is `/ˈdu.ɪŋ/` and
 * `knowing` is `/ˈnoʊ.ɪŋ/`, so hiatus is far more common than a tokenisation
 * failure. A defect is claimed only where the source entry itself proves it —
 * a provably British transcription that survived the en-us profile, or an
 * offglide mark stating that two stored vowel units were one diphthong.
 *
 * Every seeded transcription came from a Wiktionary entry preserved in
 * `data/seed/<variant>.raw.json` with the accent labels Wiktionary attached,
 * so the judgement is made from that evidence. Nothing here writes; callers
 * decide what a defect means for them.
 */

import { normaliseSource } from './ipa-tokenization.service.js';

/**
 * Accent labels that are not General American.
 *
 * Wiktionary attaches these itself, so a label is evidence rather than a guess.
 * A transcription can carry several; only one non-US label with no US label
 * alongside it makes the row suspect.
 */
const NON_US_ACCENTS = new Set([
  'RP', 'UK', 'SSB', 'AU', 'NZ', 'Scotland', 'Wales', 'Northern England',
  'Ireland', 'India', 'Indic', 'South Africa', 'General Australian',
]);

const US_ACCENTS = new Set(['GA', 'GenAm', 'US', 'America', 'American', 'Canada', 'CA', 'cot-caught']);

/**
 * Notation that en-GB uses and the en-us profile should never keep.
 *
 * `/əʊ/` is the GOAT vowel of RP where en-us has `/oʊ/`, and `/ɒ/` is the LOT
 * vowel RP distinguishes and General American does not. Either surviving into a
 * canonical en-us row means the profile took a British transcription.
 *
 * `/ɜː/` counts only where no `/ɹ/` follows. `/bɜː(ɹ)k/` writes the rhotic
 * realisation as optional, and D4 §5.4 resolves it to General American `/ɝ/` —
 * an approved normalisation, not a British form that survived.
 */
const BRITISH_NOTATION = [
  [/əʊ/, 'RP GOAT vowel /əʊ/'],
  [/ɒ/, 'RP LOT vowel /ɒ/'],
  [/ɜː(?!\(?ɹ)/, 'RP NURSE vowel /ɜː/'],
];

const stripSlashes = (ipa) => ipa.replace(/^[/[]|[/\]]$/g, '');

/**
 * Find the proven source-profile defects among stored pronunciations.
 *
 * @param {object} input
 * @param {Array<{pronunciationId: number, wordId: number, ipaTranscription: string}>} input.pronunciations
 * @param {Map<number, string[]>} input.unitsByPronunciation canonical unit symbols per pronunciation
 * @param {Map<number, string>} input.headwordByWordId
 * @param {Array<object>} input.rawEntries the `entries` of `<variant>.raw.json`
 * @returns {{defects: Array<object>, unprovable: Array<object>}}
 */
export function findSourceDefects({ pronunciations, unitsByPronunciation, headwordByWordId, rawEntries }) {
  const entriesByHeadword = new Map();
  for (const entry of rawEntries) {
    if (!entriesByHeadword.has(entry.headword)) entriesByHeadword.set(entry.headword, []);
    entriesByHeadword.get(entry.headword).push(entry);
  }

  const defects = [];
  const unprovable = [];

  for (const pronunciation of pronunciations) {
    // Only a Wiktionary-derived row can carry a Wiktionary normalisation
    // defect. A curated second-source row was verified against its own
    // pinned artifact when it was seeded.
    if (pronunciation.sourceKind && pronunciation.sourceKind !== 'wiktionary') continue;

    const headword = headwordByWordId.get(pronunciation.wordId);
    const entries = entriesByHeadword.get(headword) ?? [];

    // Which source transcription produced this row? Re-run the source profile
    // over each candidate and keep the ones whose canonical form matches.
    const matches = [];
    for (const entry of entries) {
      for (const transcription of entry.transcriptions ?? []) {
        let forms = [];
        try {
          forms = normaliseSource(stripSlashes(transcription.ipa)).forms;
        } catch {
          continue;
        }
        if (forms.includes(pronunciation.ipaTranscription)) {
          matches.push({ entry, transcription });
        }
      }
    }

    if (matches.length === 0) {
      unprovable.push({ pronunciation, headword });
      continue;
    }

    // A row is only suspect when EVERY source that could have produced it is
    // provably British. Each match is judged on its own evidence, because a
    // word commonly carries several transcriptions and the presence of an RP
    // sibling says nothing about the form actually seeded: `water` has both
    // `/ˈwɔ.tɚ/` and an Irish `/ˈwɔː.təɹ/`, and only the first produced the
    // canonical row.
    const britishEvidence = ({ transcription }) => {
      const found = [];
      const accents = transcription.accents ?? [];
      if (accents.some((accent) => US_ACCENTS.has(accent))) return found;
      for (const [needle, label] of BRITISH_NOTATION) {
        if (needle.test(transcription.ipa)) found.push(label);
      }
      for (const accent of accents) {
        if (NON_US_ACCENTS.has(accent)) found.push(`source labelled ${accent}`);
      }
      return found;
    };

    const evidence = matches.map((match) => britishEvidence(match));
    const reasons = new Set();

    // Any match that is not provably British clears the row of THAT charge —
    // including an unlabelled one, which is a general form rather than a
    // British claim.
    if (!evidence.some((found) => found.length === 0)) {
      for (const reason of evidence.flat()) reasons.add(reason);
    }

    // A second, independent proof. The non-syllabic offglide mark is the source
    // stating that two vowel letters are ONE diphthong. D4 §5 drops the mark,
    // which is correct for `/aɪ̯/` because `/aɪ/` is canonical — but where the
    // source spells a diphthong the inventory lacks, as `/ˈlʌɪ̯f/`, dropping the
    // mark leaves two separate vowel units and the diphthong is lost.
    //
    // It is a defect only when THAT marked pair became two adjacent canonical
    // units. `crying` is `/ˈkɹaɪ̯.ɪŋ/`: the mark belongs to `/aɪ/`, one unit, and
    // the `/ɪ/` after it is ordinary hiatus, so nothing was split.
    const units = unitsByPronunciation.get(pronunciation.pronunciationId) ?? [];
    const splitByOffglide = ({ transcription }) =>
      [...transcription.ipa.normalize('NFC').matchAll(/(\p{L})([ɪʊ])\u032F/gu)].some(([, vowel, glide]) =>
        units.some((symbol, index) => symbol === vowel && units[index + 1] === glide),
      );
    if (matches.some(splitByOffglide)) {
      reasons.add('source marks one diphthong with an offglide; canonical row holds two vowel units');
    }

    if (reasons.size === 0) continue;

    defects.push({
      headword,
      pronunciationId: pronunciation.pronunciationId,
      sourceIpa: matches.map(({ transcription }) => transcription.ipa).join(' | '),
      sourceAccents: [...new Set(matches.flatMap(({ transcription }) => transcription.accents ?? []))],
      canonicalIpa: pronunciation.ipaTranscription,
      units: (unitsByPronunciation.get(pronunciation.pronunciationId) ?? []).join(' '),
      sourceReference: matches[0].entry.sourceUrl,
      sourceLicence: matches[0].entry.sourceLicence,
      reasons: [...reasons].sort(),
    });
  }

  return { defects, unprovable };
}
