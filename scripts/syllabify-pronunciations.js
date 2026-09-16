/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Fill in the syllable boundaries the sources omit (FR-WORD-03, FR-IPA-01,
 * D4 §3.8, E1).
 *
 * Wiktionary supplies a separator inconsistently: most seeded pronunciations
 * arrive without one, so the written breakdown for `darling` reads `ˈdɑɹlɪŋ`
 * where a pronunciation dictionary would divide it `ˈdɑɹ·lɪŋ`. This stage
 * computes the missing divisions and writes them to `syllable_breakdown`.
 *
 * It writes `syllable_breakdown` ONLY. `ipa_transcription` is half of the
 * natural key `(word_id, ipa_transcription)`; writing separators into it would
 * make the next `npm run seed` delete and re-insert the row, changing its
 * `pronunciation_id` and orphaning its whole-word audio (SDD v1.1 §4.2).
 *
 * The layer that decides each row is `planSyllableBreakdown`: source
 * separator, then maintainer curation, then a hold on proven source-profile
 * defects, then a reviewed row of `<variant>.syllable-overrides.json`, then the
 * algorithm, then nothing.
 *
 * Pipeline position: after `seed` and `seed:phonemes`. It reads the stored
 * canonical units, and `seed` rewrites the column it writes, so it must run
 * again after every `seed`. A second run writes nothing.
 *
 * Usage:
 *   node scripts/syllabify-pronunciations.js              # report only
 *   node scripts/syllabify-pronunciations.js --limit 20   # report a sample
 *   node scripts/syllabify-pronunciations.js --apply      # write
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { closePool } from '../src/lib/mysql.js';
import { listOccurrencesForVariant } from '../src/repositories/phonemes.repository.js';
import {
  listAllPronunciations,
  listWordsForVariant,
  updatePronunciationSyllableBreakdown,
} from '../src/repositories/words.repository.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { findSourceDefects } from '../src/services/source-defects.service.js';
import { planSyllableBreakdown } from '../src/services/syllabification.service.js';
import { deriveSyllableBreakdown } from '../src/services/word-ingestion.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', 'data', 'seed');

const out = (line) => process.stdout.write(`${line}\n`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limit = Number(argValue('--limit') ?? 12);

  const variant = await resolveActiveVariant('en-us');
  const inventory = await readJson(path.join(seedDir, `${variant.code}.phonemes.json`));
  const categories = new Map(inventory.units.map((unit) => [unit.ipaSymbol, unit.category]));
  const overrides = await readJson(path.join(seedDir, `${variant.code}.syllable-overrides.json`));

  // Keyed on content, not `pronunciation_id`, so a rebuilt database whose ids
  // differ still finds its reviewed rows.
  const overrideKey = (headword, transcription) => `${headword}|${transcription}`;
  const overrideByKey = new Map(overrides.rows.map((row) => [overrideKey(row.headword, row.canonicalIpa), row]));

  const [pronunciations, occurrences, words] = await Promise.all([
    listAllPronunciations(variant.variantId),
    listOccurrencesForVariant(variant.variantId),
    listWordsForVariant(variant.variantId),
  ]);
  const headwordByWordId = new Map(words.map((word) => [word.wordId, word.normalizedHeadword]));

  const unitsByPronunciation = new Map();
  for (const occurrence of occurrences) {
    if (!unitsByPronunciation.has(occurrence.pronunciationId)) {
      unitsByPronunciation.set(occurrence.pronunciationId, []);
    }
    unitsByPronunciation.get(occurrence.pronunciationId).push({
      ipaSymbol: occurrence.ipaSymbol,
      category: categories.get(occurrence.ipaSymbol) ?? 'consonant',
    });
  }

  // A defective row's units are not the word's sounds — `close` stored as
  // /ɔ/ + /ʊ/ — so dividing them would teach a false syllable count.
  const { defects } = findSourceDefects({
    pronunciations,
    unitsByPronunciation: new Map(
      [...unitsByPronunciation].map(([id, units]) => [id, units.map((unit) => unit.ipaSymbol)]),
    ),
    headwordByWordId,
    rawEntries: (await readJson(path.join(seedDir, `${variant.code}.raw.json`))).entries,
  });
  const defectIds = new Set(defects.map((defect) => defect.pronunciationId));

  const tally = new Map();
  const planned = [];
  const usedOverrides = new Set();

  for (const pronunciation of pronunciations) {
    const key = overrideKey(headwordByWordId.get(pronunciation.wordId), pronunciation.ipaTranscription);
    const override = overrideByKey.get(key);
    if (override) usedOverrides.add(key);

    const plan = planSyllableBreakdown({
      transcription: pronunciation.ipaTranscription,
      storedBreakdown: pronunciation.syllableBreakdown,
      derivedBreakdown: deriveSyllableBreakdown(pronunciation.ipaTranscription),
      units: unitsByPronunciation.get(pronunciation.pronunciationId) ?? [],
      override,
      sourceDefect: defectIds.has(pronunciation.pronunciationId),
      toBreakdown: deriveSyllableBreakdown,
    });

    const changed = plan.breakdown !== pronunciation.syllableBreakdown;
    const bucket = `${plan.source}${changed ? '' : ' (unchanged)'}`;
    tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
    if (changed) planned.push({ ...pronunciation, next: plan.breakdown, source: plan.source });
  }

  out(`Syllable breakdowns for ${variant.code}\n`);
  out(`  pronunciations           ${pronunciations.length}`);
  for (const [bucket, count] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
    out(`  ${bucket.padEnd(34)} ${count}`);
  }
  out(`  would change             ${planned.length}\n`);

  for (const row of planned.slice(0, limit)) {
    out(`    ${row.syllableBreakdown}  ->  ${row.next}   (${row.source})`);
  }
  if (planned.length > limit) out(`    … and ${planned.length - limit} more`);

  // An override row that matches no stored pronunciation is stale: the source
  // or the canonical form changed after the review. It is reported, never
  // silently dropped.
  const stale = overrides.rows.filter((row) => !usedOverrides.has(overrideKey(row.headword, row.canonicalIpa)));
  if (stale.length > 0) {
    out(`\n  ${stale.length} override row(s) match no stored pronunciation:`);
    for (const row of stale) out(`    ${row.headword} ${row.canonicalIpa}`);
  }

  if (!apply) {
    out('\nReport only. Nothing was written. Re-run with --apply to write.');
    return;
  }

  for (const row of planned) {
    await updatePronunciationSyllableBreakdown(row.pronunciationId, row.next);
  }
  out(`\nwrote ${planned.length} syllable breakdown(s)`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
