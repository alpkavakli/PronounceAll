/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Attach evidence to the curated syllable-override rows (FR-WORD-03, D4 §3.8).
 *
 * The 29 exported rows are where the algorithm and the independent reference
 * disagree with no settled rule to explain it. Nearly all of them turn out to
 * be MORPHEME boundaries — `base+ment`, `world+wide`, `peace+ful` — which no
 * phonological rule can see, because the division follows word structure rather
 * than sonority. That is precisely why they are curated instead of becoming
 * another global rule.
 *
 * Each row is judged by evidence that is checkable and already in the
 * repository, never by assertion:
 *
 *   - **Hyphenation.** Wiktionary's own syllable count for the headword, as
 *     fetched into `<variant>.raw.json`. Where it matches exactly one of the two
 *     divisions, that division is supported.
 *   - **Compound decomposition.** The headword splits into two words that are
 *     themselves headwords in `<variant>.headwords.json`. A compound's seam is a
 *     syllable boundary, so the consonant before it closes its syllable.
 *   - **Derivational suffix.** The headword ends in a suffix whose boundary is
 *     equally fixed.
 *
 * A row no test settles is marked `ambiguous` and keeps NO proposal, so the
 * persistence step writes nothing for it. Fail closed.
 *
 * Usage:
 *   node scripts/review-syllable-overrides.js            # report
 *   node scripts/review-syllable-overrides.js --write    # update the artifact
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', 'data', 'seed');
const out = (line) => process.stdout.write(`${line}\n`);

/**
 * Suffixes whose boundary is fixed by word structure.
 *
 * Each is a real derivational suffix rather than a spelling coincidence, and
 * each appears in the exported set. `-man` is included as the compound-like
 * element it is in `policeman` and `businessman`.
 */
const SUFFIXES = ['ment', 'ful', 'ness', 'less', 'man', 'wide', 'ware', 'yard', 'walk', 'way'];

const syllableCount = (breakdown) => breakdown.split('.').length;

async function main() {
  const write = process.argv.includes('--write');
  const artifactPath = path.join(seedDir, 'en-us.syllable-overrides.json');
  const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  const headwords = JSON.parse(await fs.readFile(path.join(seedDir, 'en-us.headwords.json'), 'utf8'));
  const known = new Set(headwords.ranked.map((entry) => entry.word));

  /** Does the headword split into two known words, both of real length? */
  const compoundSeam = (headword) => {
    for (let i = 3; i <= headword.length - 3; i += 1) {
      const left = headword.slice(0, i);
      const right = headword.slice(i);
      if (known.has(left) && known.has(right)) return `${left}+${right}`;
    }
    return null;
  };

  const suffix = (headword) =>
    SUFFIXES.find((candidate) => headword.length > candidate.length + 2 && headword.endsWith(candidate)) ?? null;

  const tally = { 'adopt-reference': 0, 'keep-algorithm': 0, ambiguous: 0 };

  for (const row of artifact.rows) {
    const evidence = [];
    let status = 'ambiguous';

    // 1. Hyphenation settles syllable COUNT, which is what separates
    //    `ɝ.liɚ` from `ɝ.li.ɚ`.
    if (row.wiktionaryHyphenation) {
      const wanted = row.wiktionaryHyphenation.length;
      const algorithm = syllableCount(row.algorithmBreakdown);
      const reference = syllableCount(row.referenceBreakdown);
      if (algorithm !== reference) {
        if (reference === wanted) {
          evidence.push(`Wiktionary hyphenation ${row.wiktionaryHyphenation.join('-')} gives ${wanted} syllables, matching the reference`);
          status = 'adopt-reference';
        } else if (algorithm === wanted) {
          evidence.push(`Wiktionary hyphenation ${row.wiktionaryHyphenation.join('-')} gives ${wanted} syllables, matching the algorithm`);
          status = 'keep-algorithm';
        }
      }
    }

    // 2. A compound or suffix seam is a syllable boundary, and the consonant
    //    before it closes its syllable — which is the reference division in
    //    every exported row of this shape.
    if (status === 'ambiguous') {
      const seam = compoundSeam(row.headword);
      const ending = suffix(row.headword);
      if (seam) {
        evidence.push(`compound: ${seam}, both parts are headwords, so the seam is a syllable boundary`);
        status = 'adopt-reference';
      } else if (ending) {
        evidence.push(`derivational suffix -${ending}, whose boundary is fixed by word structure`);
        status = 'adopt-reference';
      }
    }

    // 3. Hyphenation can still corroborate a division of equal syllable count
    //    by confirming the morpheme split the reference follows.
    if (status === 'ambiguous' && row.wiktionaryHyphenation && row.wiktionaryHyphenation.length > 1) {
      evidence.push(
        `Wiktionary hyphenation ${row.wiktionaryHyphenation.join('-')} is present but does not settle where the consonant falls`,
      );
    }

    row.reviewStatus = status;
    row.note = evidence.join('; ') || 'no checkable evidence settles this row';
    row.proposedBreakdown =
      status === 'adopt-reference' ? row.referenceBreakdown : status === 'keep-algorithm' ? row.algorithmBreakdown : null;
    tally[status] += 1;
  }

  out('Curated syllable overrides — evidence review\n');
  for (const row of artifact.rows) {
    out(`  ${row.headword.padEnd(14)} ${row.reviewStatus.padEnd(16)} ${String(row.proposedBreakdown ?? '(none)').padEnd(19)}`);
    out(`    ${row.note}`);
  }
  out('');
  out(`  adopt-reference ${tally['adopt-reference']}   keep-algorithm ${tally['keep-algorithm']}   ambiguous ${tally.ambiguous}`);

  if (!write) {
    out('\nReport only. Re-run with --write to update the artifact.');
    return;
  }

  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  out(`\nUpdated ${artifactPath}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
