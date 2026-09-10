/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Iteration 2 seed entry point (decisions E1, E2, C6; FR-IPA-01,
 * FR-CONTENT-02; D4).
 *
 * E1 puts the one-off import ENTRY POINT in `scripts/` and the reusable logic in
 * `services/`, so this file is thin: it resolves the variant, runs the three
 * stages in order, prints a reviewable report, and asserts the invariants.
 *
 * Stage order is deliberate and is NOT the order the iteration plan lists:
 *
 *   1. reconcile the word pronunciations, so the corpus contains only rows the
 *      canonical inventory can represent (D4 §5.7);
 *   2. seed the inventory, deriving `frequency_rank` from occurrence counts over
 *      THAT corpus (D4 §6) — deriving it first would rank against rows about to
 *      be deleted and miss the realisations expansion is about to add;
 *   3. populate `pronunciation_phonemes` from the same tokenisation.
 *
 * Usage:
 *   node scripts/seed-phonemes.js --dry-run   # reconcile report only, no writes
 *   node scripts/seed-phonemes.js             # all three stages
 */

import process from 'node:process';

import { closePool } from '../src/lib/mysql.js';
import { assetKeyFor, ASSET_KIND, registerAsset } from '../src/services/audio-asset.service.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { loadInventory } from '../src/services/ipa-tokenization.service.js';
import {
  populateOccurrences,
  reconcilePronunciations,
  seedPhonemes,
  validateSeed,
} from '../src/services/phoneme-ingestion.service.js';

const out = (line) => process.stdout.write(`${line}\n`);

/**
 * Register the audio asset a canonical unit requires, returning its id.
 *
 * A `pending` row is a REAL, licensed intent to hold a specific recording — it
 * is not a placeholder that makes the NOT NULL foreign key satisfiable. Nothing
 * here invents a digest, a file, or a length: those columns stay null until an
 * actual asset is produced, and the `ck_audio_assets_ready_is_complete` check
 * constraint refuses to let a row claim readiness without them.
 *
 * The consequence is deliberate and is reported by this script: after seeding,
 * the inventory is structurally complete and audibly empty. FR-CONTENT-02 is not
 * satisfied until the assets are generated.
 *
 * @param {object} variant
 * @returns {(unit: object) => Promise<number>}
 */
function audioAssetResolver(variant) {
  return async (unit) =>
    registerAsset({
      variantId: variant.variantId,
      assetKey: assetKeyFor({
        kind: ASSET_KIND.PHONEME,
        variantCode: variant.code,
        target: unit.ipaSymbol,
        sourceKind: 'tts_piper',
      }),
      sourceKind: 'tts_piper',
      // V1: Piper with `en_US-libritts-high`, output intended for distribution
      // under CC BY-SA 4.0 with attribution to LibriTTS.
      licenceIdentifier: 'CC-BY-SA-4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attributionText: 'Synthesised with Piper (en_US-libritts-high); voice trained on LibriTTS (CC BY 4.0).',
    });
}

/** @param {object[]} rows @param {string} title */
function printList(title, rows, format) {
  if (rows.length === 0) {
    return;
  }
  out(`\n${title} (${rows.length})`);
  for (const row of rows.slice(0, 40)) {
    out(`  ${format(row)}`);
  }
  if (rows.length > 40) {
    out(`  … and ${rows.length - 40} more`);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const variantCode = process.argv.includes('--variant')
    ? process.argv[process.argv.indexOf('--variant') + 1]
    : 'en-us';

  const variant = await resolveActiveVariant(variantCode);
  if (!variant) {
    throw new Error(`No active language variant "${variantCode}".`);
  }

  const inventory = await loadInventory(variant.code);
  out(`Variant   ${variant.code} (${variant.displayName})`);
  out(`Inventory ${inventory.units.length} canonical units from D4`);

  // ---- Stage 1: reconcile -------------------------------------------------
  out(`\n${dryRun ? 'DRY RUN — ' : ''}Stage 1: reconciling word pronunciations against D4`);
  const reconciled = await reconcilePronunciations({ variant, dryRun });
  out(`  unchanged  ${reconciled.unchanged}`);
  out(`  rewritten  ${reconciled.rewritten.length}`);
  out(`  merged     ${reconciled.merged.length}`);
  out(`  candidates ${reconciled.expansionCandidates.length} (optional-segment variants, NOT written)`);
  out(`  removed    ${reconciled.removed.length}`);
  printList('Rewritten to canonical form', reconciled.rewritten,
    (r) => `${r.word.padEnd(14)} /${r.from}/ -> /${r.to}/   [${r.notes.join('; ')}]`);
  printList(
    'Optional-segment variants — REPORTED for curation, not written (D4 §5.4)',
    reconciled.expansionCandidates,
    (r) => `${r.word.padEnd(14)} /${r.from}/  kept /${r.kept}/  candidate /${r.candidate}/`,
  );
  printList('REMOVED — not representable in the canonical inventory', reconciled.removed,
    (r) => `${r.word.padEnd(14)} /${r.ipa}/   blocked by ${JSON.stringify(r.offending)}`);
  printList('BLOCKED — would leave the word with no pronunciation', reconciled.blocked,
    (r) => `${r.word.padEnd(14)} ${r.reason}`);

  if (dryRun) {
    out('\nDRY RUN — nothing was written. Stages 2 and 3 were not run.');
    return;
  }

  // ---- Stage 2: seed the inventory ---------------------------------------
  out('\nStage 2: seeding the canonical inventory');
  const seeded = await seedPhonemes({ variant, resolveAudioAssetId: audioAssetResolver(variant) });
  out(`  units seeded ${seeded.units}`);
  out('  frequency_rank derived from the reconciled corpus, top 10:');
  for (const entry of seeded.ranked.slice(0, 10)) {
    out(`    ${String(entry.frequencyRank).padStart(2)}  ${entry.ipaSymbol.padEnd(3)} ${entry.occurrences}`);
  }
  const unseen = seeded.ranked.filter((entry) => entry.occurrences === 0);
  if (unseen.length > 0) {
    out(`  units with no occurrence in this corpus, ranked last by canonical order: ${unseen.map((u) => u.ipaSymbol).join(' ')}`);
  }

  // ---- Stage 3: occurrences ----------------------------------------------
  out('\nStage 3: populating pronunciation_phonemes');
  const occurrences = await populateOccurrences({ variant });
  out(`  pronunciations mapped ${occurrences.pronunciations}`);
  out(`  clickable occurrences ${occurrences.occurrences}`);
  printList('Skipped', occurrences.skipped, (r) => `/${r.ipa}/ ${r.offending}`);

  // ---- Validation ---------------------------------------------------------
  out('\nValidating seed invariants');
  const problems = await validateSeed({ variant });
  if (problems.length === 0) {
    out('  all invariants hold');
  } else {
    out(`  ${problems.length} PROBLEM(S):`);
    for (const problem of problems) {
      out(`    - ${problem}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
