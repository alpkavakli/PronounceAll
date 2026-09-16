/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Report pronunciations whose SOURCE form proves a source-profile defect
 * (D4 §5, FR-CONTENT-04).
 *
 * This replaces an earlier heuristic that called any two adjacent vowel units a
 * "split diphthong" when the second was `/ɪ/` or `/ʊ/`. That test was wrong:
 * `doing` is `/ˈdu.ɪŋ/` and `knowing` is `/ˈnoʊ.ɪŋ/`, so adjacent vowels are
 * ordinary hiatus far more often than they are a tokenisation failure.
 * Adjacency cannot distinguish the two, and guessing produced false defects.
 *
 * A defect is only claimed where the source itself proves it. Every seeded
 * transcription came from a Wiktionary entry in `data/seed/en-us.raw.json`,
 * which preserves the raw IPA and the accent labels Wiktionary attached, so the
 * question "did an en-GB form survive the en-us profile?" is answerable from
 * evidence instead of inference.
 *
 * Nothing is written. This script only reports.
 *
 * Usage:
 *   node scripts/report-source-defects.js
 *   node scripts/report-source-defects.js --limit 40
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { closePool } from '../src/lib/mysql.js';
import { listOccurrencesForVariant } from '../src/repositories/phonemes.repository.js';
import { listAllPronunciations, listWordsForVariant } from '../src/repositories/words.repository.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { normaliseSource } from '../src/services/ipa-tokenization.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (line) => process.stdout.write(`${line}\n`);

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

/** Canonical units that can be a syllable nucleus, for the offglide check. */
const NUCLEI = new Set([
  'i', 'ɪ', 'ɛ', 'æ', 'ʌ', 'ə', 'ɑ', 'ɔ', 'ʊ', 'u', 'ɝ', 'ɚ',
  'eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'oʊ',
]);

/**
 * Notation that en-GB uses and the en-us profile should never keep.
 *
 * `/əʊ/` is the GOAT vowel of RP where en-us has `/oʊ/`, and `/ɒ/` is the LOT
 * vowel RP distinguishes and General American does not. Either surviving into a
 * canonical en-us row means the profile took a British transcription.
 */
const BRITISH_NOTATION = [
  ['əʊ', 'RP GOAT vowel /əʊ/'],
  ['ɒ', 'RP LOT vowel /ɒ/'],
  ['ɜː', 'RP NURSE vowel /ɜː/'],
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

const stripSlashes = (ipa) => ipa.replace(/^[/[]|[/\]]$/g, '');

async function main() {
  const limit = Number(argValue('--limit') ?? 25);
  const variant = await resolveActiveVariant('en-us');

  const raw = JSON.parse(
    await fs.readFile(path.join(here, '..', 'data', 'seed', `${variant.code}.raw.json`), 'utf8'),
  );
  const entriesByHeadword = new Map();
  for (const entry of raw.entries) {
    if (!entriesByHeadword.has(entry.headword)) entriesByHeadword.set(entry.headword, []);
    entriesByHeadword.get(entry.headword).push(entry);
  }

  const [pronunciations, occurrences, words] = await Promise.all([
    listAllPronunciations(variant.variantId),
    listOccurrencesForVariant(variant.variantId),
    listWordsForVariant(variant.variantId),
  ]);

  const headwordByWordId = new Map(
    words.map((word) => [word.wordId, word.normalizedHeadword ?? word.displayHeadword]),
  );

  const unitsByPronunciation = new Map();
  for (const occurrence of occurrences) {
    if (!unitsByPronunciation.has(occurrence.pronunciationId)) {
      unitsByPronunciation.set(occurrence.pronunciationId, []);
    }
    unitsByPronunciation.get(occurrence.pronunciationId).push(occurrence.ipaSymbol);
  }

  const defects = [];
  const unprovable = [];

  for (const pronunciation of pronunciations) {
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
        if (transcription.ipa.includes(needle)) found.push(label);
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
    // source spells the diphthong differently, as General American `/ɔʊ̯/` for
    // `/oʊ/`, dropping the mark leaves two separate vowel units and the
    // diphthong is lost. The source proved its own intent, so this needs no
    // inference from adjacency.
    // The split has to look like the one the offglide describes: a vowel
    // followed by the GLIDE itself as a separate nucleus. `quiet` is
    // `/ˈkwaɪ̯.ət/` and tokenises as `aɪ` + `ə` — the offglide there belongs to
    // `/aɪ/`, which is already one canonical unit, and the `ə` after it is
    // ordinary hiatus. Requiring the second unit to be `/ɪ/` or `/ʊ/` keeps
    // that out while still catching `ɔ` + `ʊ`.
    const splitDiphthong = (units) =>
      units.some(
        (symbol, index) =>
          index > 0 && ['ɪ', 'ʊ'].includes(symbol) && NUCLEI.has(units[index - 1]),
      );

    if (splitDiphthong(unitsByPronunciation.get(pronunciation.pronunciationId) ?? [])) {
      for (const { transcription } of matches) {
        if (transcription.ipa.includes('̯')) {
          reasons.add('source marks one diphthong with an offglide; canonical row holds two vowel units');
        }
      }
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

  out('Source-profile defect report (D4 §5)\n');
  out(`  pronunciations examined      ${pronunciations.length}`);
  out(`  source transcription found   ${pronunciations.length - unprovable.length}`);
  out(`  no matching source           ${unprovable.length}   (cannot be judged from evidence; not a defect claim)`);
  out(`  proven source-profile defect ${defects.length}\n`);

  for (const defect of defects.slice(0, limit)) {
    out(`  ${defect.headword}  (pronunciation_id ${defect.pronunciationId})`);
    out(`    source IPA      ${defect.sourceIpa}`);
    out(`    source accents  ${defect.sourceAccents.join(', ') || '(none stated)'}`);
    out(`    canonical IPA   ${defect.canonicalIpa}`);
    out(`    canonical units ${defect.units}`);
    out(`    source          ${defect.sourceReference}  (${defect.sourceLicence})`);
    out(`    flagged because ${defect.reasons.join('; ')}`);
    out('');
  }
  if (defects.length > limit) out(`  … and ${defects.length - limit} more`);

  out('\nNothing was written. Every row above needs a decision: re-seed from a US');
  out('source, drop the row, or accept it. None is repaired automatically.');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
