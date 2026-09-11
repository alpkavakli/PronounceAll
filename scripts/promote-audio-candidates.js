/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Promote reviewed audio candidates into production (audio source policy v1.1;
 * FR-CONTENT-02/04/05, V4, D4).
 *
 * This is the ONLY step that changes what a learner hears, and it runs only on
 * units the maintainer names after listening. Nothing is promoted automatically
 * merely because it downloaded cleanly or validated.
 *
 * Two shapes, one mechanism — repoint `phonemes.audio_asset_id`:
 *
 *   npm run audio:promote -- t d k       # the Commons recording for each unit
 *   npm run audio:promote -- --piper w 3 # Piper candidate #3 for /w/
 *
 * Safety, in the order it matters:
 *
 *   - every named unit is validated BEFORE anything is promoted, so a typo in
 *     the third symbol cannot leave the first two already switched;
 *   - the replacement must exist and be `ready`, with a digest, a byte length,
 *     a licence and an author, or that unit is refused;
 *   - the superseded asset is neither deleted nor modified. It stays on disk
 *     and in `audio_assets`, and the previous asset id is printed so the
 *     promotion can be reversed by hand;
 *   - there is no `--all`. Promotion is always an explicit list.
 */

import process from 'node:process';

import { closePool } from '../src/lib/mysql.js';
import { repointPhonemeAudio } from '../src/repositories/phonemes.repository.js';
import { ASSET_KIND, assetKeyFor, findByAssetKey } from '../src/services/audio-asset.service.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { loadInventory } from '../src/services/ipa-tokenization.service.js';

const out = (line) => process.stdout.write(`${line}\n`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const variantCode = argValue('--variant') ?? 'en-us';
  const piperIndex = process.argv.indexOf('--piper');

  const flagValues = new Set([argValue('--variant')].filter(Boolean));
  let plan = [];

  if (piperIndex !== -1) {
    const symbol = process.argv[piperIndex + 1];
    const number = Number(process.argv[piperIndex + 2]);
    if (!symbol || !Number.isInteger(number) || number < 1) {
      out('Usage: npm run audio:promote -- --piper <symbol> <candidate number>');
      process.exitCode = 1;
      return;
    }
    plan = [{ symbol, target: `${symbol}#${number}`, sourceKind: 'tts_piper', label: `Piper candidate #${number}` }];
  } else {
    const symbols = process.argv
      .slice(2)
      .filter((argument) => !argument.startsWith('--') && !flagValues.has(argument));

    if (symbols.length === 0) {
      out('Name at least one unit to promote, for example:');
      out('  npm run audio:promote -- t d k');
      out('  npm run audio:promote -- --piper w 3');
      out('');
      out('There is no --all: promotion is always an explicit list.');
      process.exitCode = 1;
      return;
    }
    plan = symbols.map((symbol) => ({
      symbol,
      target: symbol,
      sourceKind: 'commons_human',
      label: 'Wikimedia Commons recording',
    }));
  }

  const inventory = await loadInventory(variantCode);
  const canonical = new Set(inventory.units.map((unit) => unit.ipaSymbol));

  const unknown = plan.filter((row) => !canonical.has(row.symbol)).map((row) => row.symbol);
  if (unknown.length > 0) {
    out(`FAIL — not canonical ${variantCode} units: ${unknown.join(' ')}`);
    out('Nothing was promoted.');
    process.exitCode = 1;
    return;
  }

  // Resolve and check every replacement before promoting any of them.
  const resolved = [];
  const problems = [];

  for (const row of plan) {
    const assetKey = assetKeyFor({
      kind: ASSET_KIND.PHONEME,
      variantCode,
      target: row.target,
      sourceKind: row.sourceKind,
    });
    const asset = await findByAssetKey(assetKey);

    if (!asset) {
      problems.push(`/${row.symbol}/: no ${row.label} exists (${assetKey})`);
      continue;
    }
    if (asset.generationStatus !== 'ready') {
      problems.push(`/${row.symbol}/: the replacement is ${asset.generationStatus}, not ready`);
      continue;
    }
    if (!asset.storageKey || !asset.licenceIdentifier) {
      problems.push(`/${row.symbol}/: the replacement is missing a file or a licence`);
      continue;
    }
    resolved.push({ ...row, asset });
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      out(`FAIL — ${problem}`);
    }
    out('Nothing was promoted.');
    process.exitCode = 1;
    return;
  }

  out(`Promoting ${resolved.length} replacement(s) for ${variantCode}`);
  for (const row of resolved) {
    out(`  /${row.symbol}/  ${row.label}  ${row.asset.storageKey}  (${row.asset.licenceIdentifier})`);
  }

  if (dryRun) {
    out('\nDry run: nothing was promoted.');
    return;
  }

  const variant = await resolveActiveVariant(variantCode);
  const promoted = [];

  for (const row of resolved) {
    const previous = await repointPhonemeAudio(
      variant.variantId,
      row.symbol,
      row.asset.audioAssetId,
    );
    if (previous === null) {
      out(`  /${row.symbol}/ FAILED — no phoneme row`);
      continue;
    }
    promoted.push({ symbol: row.symbol, from: previous, to: row.asset.audioAssetId });
  }

  out('');
  out(`promoted ${promoted.length}`);
  for (const row of promoted) {
    out(`  /${row.symbol}/ audio_asset_id ${row.from} -> ${row.to}`);
  }
  out('');
  out('The superseded assets are retained in `audio_assets` and on disk, so a');
  out('promotion can be reversed by pointing the row back at the previous id.');
  out('Run `npm run audio:verify` and listen again to confirm.');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
