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
import { findSourceDefects } from '../src/services/source-defects.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (line) => process.stdout.write(`${line}\n`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const limit = Number(argValue('--limit') ?? 25);
  const variant = await resolveActiveVariant('en-us');

  const raw = JSON.parse(
    await fs.readFile(path.join(here, '..', 'data', 'seed', `${variant.code}.raw.json`), 'utf8'),
  );
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

  const { defects, unprovable } = findSourceDefects({
    pronunciations,
    unitsByPronunciation,
    headwordByWordId,
    rawEntries: raw.entries,
  });

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
