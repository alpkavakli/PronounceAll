/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The FR-CONTENT-04 audio integrity check (also V4, C6, FR-CONTENT-02, D4).
 *
 * FR-CONTENT-04 requires a startup or nightly check that every referenced asset
 * has a file on disk, a recorded digest, a MIME type, a non-zero length, and
 * recorded provenance and licensing. This is the runnable form of that check,
 * and it is also the acceptance gate for phoneme audio generation: it asserts
 * that every canonical D4 unit has an asset that is actually `ready`.
 *
 * It reports honestly on an empty inventory. Today it exits non-zero because no
 * phoneme audio has been generated, which is the true state of the system, not
 * a failure of this script.
 *
 * Usage:
 *   node scripts/verify-audio-assets.js              # check the en-us inventory
 *   node scripts/verify-audio-assets.js --variant en-us
 */

import process from 'node:process';

import * as storage from '../src/lib/audio-storage.js';
import { closePool } from '../src/lib/mysql.js';
import { listPhonemeAudio } from '../src/repositories/phonemes.repository.js';
import { statusSummary, verifyIntegrity } from '../src/services/audio-asset.service.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { loadInventory } from '../src/services/ipa-tokenization.service.js';

const out = (line) => process.stdout.write(`${line}\n`);

const STATUSES = ['pending', 'claimed', 'ready', 'failed'];

/** Fields FR-CONTENT-04 requires on every referenced asset. */
function provenanceProblems(asset) {
  const problems = [];
  if (!asset.licenceIdentifier) {
    problems.push('no licence identifier');
  }
  if (!asset.attributionText) {
    problems.push('no attribution text');
  }
  if (asset.sourceKind?.endsWith('_human')) {
    if (!asset.sourceReference) {
      problems.push('human recording with no upstream source reference');
    }
    if (!asset.author) {
      problems.push('human recording with no author, so it cannot be attributed');
    }
  }
  return problems;
}

async function main() {
  const variantCode = process.argv.includes('--variant')
    ? process.argv[process.argv.indexOf('--variant') + 1]
    : 'en-us';

  out(`Verifying audio assets for ${variantCode}`);
  // Logs the configured root, so a misconfigured deployment is visible in the
  // same output that reports the verdict.
  storage.describeStorage();

  // ---- Status summary -----------------------------------------------------
  const summary = await statusSummary();
  out('\nGeneration status');
  for (const status of STATUSES) {
    out(`  ${status.padEnd(8)} ${summary[status] ?? 0}`);
  }

  // ---- File integrity over every ready asset ------------------------------
  out('\nIntegrity of ready assets (FR-CONTENT-04)');
  const integrity = await verifyIntegrity(storage);
  out(`  checked ${integrity.checked}`);
  if (integrity.problems.length === 0) {
    out('  no missing files, no digest mismatches, no zero-byte files');
  } else {
    out(`  ${integrity.problems.length} PROBLEM(S):`);
    for (const problem of integrity.problems) {
      out(`    - ${problem.assetKey}: ${problem.problem}`);
    }
  }

  // ---- Canonical phoneme coverage (FR-CONTENT-02, D4) ---------------------
  // Follow what each phoneme ACTUALLY serves. Since the hybrid audio policy a
  // unit may serve a Piper clip or a Commons human recording, so deriving a key
  // from an assumed source would report a promoted unit as missing.
  out('\nCanonical phoneme coverage (FR-CONTENT-02)');
  const variant = await resolveActiveVariant(variantCode);
  const inventory = await loadInventory(variantCode);
  const served = await listPhonemeAudio(variant.variantId);
  const bySymbol = new Map(served.map((row) => [row.ipaSymbol, row]));

  const notReady = [];
  const provenance = [];
  const bySource = {};

  for (const unit of inventory.units) {
    const row = bySymbol.get(unit.ipaSymbol);

    if (!row) {
      notReady.push({ symbol: unit.ipaSymbol, state: 'no phoneme row' });
      continue;
    }
    if (!row.audioAssetId) {
      notReady.push({ symbol: unit.ipaSymbol, state: 'no audio asset referenced' });
      continue;
    }
    if (row.generationStatus !== 'ready') {
      notReady.push({ symbol: unit.ipaSymbol, state: row.generationStatus });
    }

    bySource[row.sourceKind] = (bySource[row.sourceKind] ?? 0) + 1;

    for (const problem of provenanceProblems(row)) {
      provenance.push({ symbol: unit.ipaSymbol, problem });
    }
  }

  const ready = inventory.units.length - notReady.length;
  out(`  ${ready} of ${inventory.units.length} canonical units serve ready audio`);
  for (const [kind, count] of Object.entries(bySource)) {
    out(`    ${kind.padEnd(16)} ${count}`);
  }

  if (notReady.length > 0) {
    out(`  ${notReady.length} NOT ready:`);
    for (const row of notReady.slice(0, 45)) {
      out(`    - /${row.symbol}/ ${row.state}`);
    }
  }

  if (provenance.length > 0) {
    out(`  ${provenance.length} provenance/licensing PROBLEM(S):`);
    for (const row of provenance.slice(0, 45)) {
      out(`    - /${row.symbol}/ ${row.problem}`);
    }
  } else {
    out('  every unit records a licence, attribution and author where required');
  }

  // ---- Verdict ------------------------------------------------------------
  const failures = integrity.problems.length + notReady.length + provenance.length;
  out('');
  if (failures === 0) {
    out('PASS — every canonical unit has a verified audio asset.');
  } else {
    out(`FAIL — ${failures} problem(s). FR-CONTENT-02/04 are not satisfied.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
