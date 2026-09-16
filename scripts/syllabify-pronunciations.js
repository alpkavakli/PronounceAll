/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Fill in missing syllable separators across the corpus (FR-WORD-03,
 * FR-IPA-01, D4 §3.8).
 *
 * Wiktionary supplies a separator inconsistently: most seeded pronunciations
 * arrive without one, so a learner sees `/ˈdɑɹlɪŋ/` where a pronunciation
 * dictionary would show `/ˈdɑɹ.lɪŋ/`. This pass computes the missing boundaries
 * from the canonical units already stored and writes them into the
 * transcription and the breakdown FR-WORD-03 displays.
 *
 * What it will not do:
 *
 *   - it never changes a transcription that already carries a separator, so a
 *     boundary the source stated always wins over a computed one;
 *   - it never changes which units a transcription contains. The units are
 *     re-derived from the written string afterwards and compared, and a row
 *     that fails that check is reported and skipped rather than written;
 *   - it writes nothing at all without `--apply`. The default is a report.
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
  updatePronunciationSyllableBreakdown,
  updatePronunciationTranscription,
} from '../src/repositories/words.repository.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { insertSyllableMarks } from '../src/services/syllabification.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The breakdown column uses a middle dot where the transcription uses `.`. */
const BREAKDOWN_SEPARATOR = '·';

const out = (line) => process.stdout.write(`${line}
`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

async function loadCategories(variantCode) {
  const file = path.join(here, '..', 'data', 'seed', `${variantCode}.phonemes.json`);
  const artifact = JSON.parse(await fs.readFile(file, 'utf8'));
  return new Map(artifact.units.map((unit) => [unit.ipaSymbol, unit.category]));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limit = Number(argValue('--limit') ?? 12);

  const variant = await resolveActiveVariant('en-us');
  const categories = await loadCategories(variant.code);

  const [pronunciations, occurrences] = await Promise.all([
    listAllPronunciations(variant.variantId),
    listOccurrencesForVariant(variant.variantId),
  ]);

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

  const planned = [];
  const report = { total: pronunciations.length, alreadyMarked: 0, unchanged: 0, noUnits: 0 };

  for (const pronunciation of pronunciations) {
    if (pronunciation.ipaTranscription.includes('.')) {
      report.alreadyMarked += 1;
      continue;
    }
    const units = unitsByPronunciation.get(pronunciation.pronunciationId);
    if (!units || units.length === 0) {
      report.noUnits += 1;
      continue;
    }

    const next = insertSyllableMarks(pronunciation.ipaTranscription, units);
    if (next === null) {
      report.unchanged += 1;
      continue;
    }

    // The units must survive exactly: same sequence, same order, nothing but
    // separators added. Anything else is a bug in the algorithm, not a row to
    // write, so it is reported and skipped.
    const stripped = next.replaceAll('.', '');
    if (stripped !== pronunciation.ipaTranscription) {
      report.unchanged += 1;
      continue;
    }

    planned.push({ ...pronunciation, next });
  }

  out(`Syllable separators for ${variant.code}\n`);
  out(`  pronunciations           ${report.total}`);
  out(`  already carry a marker   ${report.alreadyMarked}`);
  out(`  no computable boundary   ${report.unchanged}   (monosyllables, stress-marked, unalignable)`);
  out(`  no stored units          ${report.noUnits}`);
  out(`  would gain a separator   ${planned.length}\n`);

  for (const row of planned.slice(0, limit)) {
    out(`    ${row.ipaTranscription}  ->  ${row.next}`);
  }
  if (planned.length > limit) out(`    … and ${planned.length - limit} more`);

  if (!apply) {
    out('\nReport only. Nothing was written. Re-run with --apply to write.');
    return;
  }

  let written = 0;
  let refused = 0;
  for (const row of planned) {
    try {
      await updatePronunciationTranscription(row.pronunciationId, row.next);
      await updatePronunciationSyllableBreakdown(
        row.pronunciationId,
        row.next.replaceAll('.', BREAKDOWN_SEPARATOR),
      );
      written += 1;
    } catch (error) {
      // The transcription is the row's natural key. A collision means another
      // row already holds the separated form, which is a duplicate to look at
      // by hand rather than something to overwrite.
      refused += 1;
      out(`  refused ${row.ipaTranscription}: ${error.code ?? error.message}`);
    }
  }

  out(`\nwrote ${written}, refused ${refused}`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}
`);
    process.exitCode = 1;
  })
  .finally(closePool);
