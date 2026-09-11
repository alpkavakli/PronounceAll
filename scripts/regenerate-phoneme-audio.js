/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Replace named canonical phoneme clips that failed the maintainer listening
 * pass (V1, C6, V4, FR-CONTENT-02/04, D4).
 *
 * A produced asset is immutable under V4 and `claimForGeneration` refuses a
 * `ready` row, so a clip cannot be replaced by accident. This is the explicit
 * operator exception, and everything about it is deliberately narrow:
 *
 *   - it acts ONLY on symbols named on the command line. There is no `--all`,
 *     no wildcard and no "everything that looks short" mode, so a mass
 *     replacement cannot happen by mistake or by a stray flag;
 *   - every symbol must be a canonical D4 unit, or nothing runs at all;
 *   - it regenerates through the SAME approved profile. It takes no synthesis
 *     parameters, because the profile is an owner decision and a clip generated
 *     under different settings would not be the approved content.
 *
 * Ordering matters. Audio is synthesised BEFORE the row is invalidated, so the
 * window in which the unit has no playable asset is milliseconds rather than
 * the length of a Piper run. If synthesis fails, the existing clip is left
 * exactly as it was.
 *
 * The previous file is NOT deleted: `storage_key` is content-addressed, so the
 * old clip remains on disk and the row simply points at a new one. That keeps
 * the change reversible by hand and cannot orphan the phoneme's
 * `audio_asset_id`, which never moves.
 *
 * Usage:
 *   node scripts/regenerate-phoneme-audio.js ɑ
 *   node scripts/regenerate-phoneme-audio.js ɑ ð θ
 *   node scripts/regenerate-phoneme-audio.js --dry-run ɑ
 */

import process from 'node:process';

import * as storage from '../src/lib/audio-storage.js';
import { closePool } from '../src/lib/mysql.js';
import { createSynthesiser, loadProfile, preflight } from '../src/lib/piper.js';
import { resetForRegeneration } from '../src/repositories/audio-assets.repository.js';
import {
  ASSET_KIND,
  assetKeyFor,
  GENERATOR_VERSION,
  PIPER_VOICE,
  produceAsset,
} from '../src/services/audio-asset.service.js';
import { loadInventory } from '../src/services/ipa-tokenization.service.js';

const out = (line) => process.stdout.write(`${line}\n`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const variantCode = argValue('--variant') ?? 'en-us';

  // Everything that is not a flag or a flag's value is a symbol to replace.
  const flagValues = new Set([argValue('--variant')].filter(Boolean));
  const symbols = process.argv
    .slice(2)
    .filter((argument) => !argument.startsWith('--') && !flagValues.has(argument));

  if (symbols.length === 0) {
    out('Name at least one canonical phoneme to regenerate, for example:');
    out('  npm run audio:regenerate:phoneme -- ɑ');
    out('  npm run audio:regenerate:phoneme -- ɑ ð θ');
    out('');
    out('There is no --all: replacing a reviewed clip is always explicit.');
    process.exitCode = 1;
    return;
  }

  const profile = await loadProfile(variantCode);
  if (profile.voice.name !== PIPER_VOICE || profile.generatorVersion !== GENERATOR_VERSION) {
    out('FAIL — profile voice/generator does not match the asset-key constants.');
    process.exitCode = 1;
    return;
  }

  // Validate EVERY symbol before touching anything: a typo in the third symbol
  // must not leave the first two already replaced.
  const inventory = await loadInventory(variantCode);
  const canonical = new Set(inventory.units.map((unit) => unit.ipaSymbol));
  const byProfile = new Map(profile.units.map((unit) => [unit.ipaSymbol, unit]));

  const unknown = symbols.filter((symbol) => !canonical.has(symbol));
  if (unknown.length > 0) {
    out(`FAIL — not canonical ${variantCode} units: ${unknown.join(' ')}`);
    out('Nothing was changed. Check the symbol against D4 — a look-alike');
    out('character (ASCII g for ɡ, for example) is the usual cause.');
    process.exitCode = 1;
    return;
  }

  const duplicates = symbols.filter((symbol, index) => symbols.indexOf(symbol) !== index);
  if (duplicates.length > 0) {
    out(`FAIL — repeated symbol(s): ${[...new Set(duplicates)].join(' ')}`);
    process.exitCode = 1;
    return;
  }

  const { problems } = await preflight(profile);
  if (problems.length > 0) {
    out('Preflight PROBLEM(S):');
    for (const problem of problems) {
      out(`  - ${problem}`);
    }
    out('\nFAIL — refusing to regenerate against a drifted or missing voice.');
    process.exitCode = 1;
    return;
  }

  out(`Regenerating ${symbols.length} clip(s) through profile ${profile.profileVersion}`);
  out(`Voice ${profile.voice.name}, speaker ${profile.voice.speakerName} (id ${profile.voice.speakerId})`);
  for (const symbol of symbols) {
    out(`  /${symbol}/  ${byProfile.get(symbol).piperInput}`);
  }

  if (dryRun) {
    out('\nDry run: nothing was invalidated or regenerated.');
    return;
  }

  const synthesise = createSynthesiser(profile);
  const replaced = [];
  const failed = [];

  for (const symbol of symbols) {
    const assetKey = assetKeyFor({
      kind: ASSET_KIND.PHONEME,
      variantCode,
      target: symbol,
      sourceKind: 'tts_piper',
    });

    // Synthesise FIRST. A failure here leaves the existing clip untouched.
    let produced;
    try {
      produced = await synthesise(byProfile.get(symbol));
    } catch (error) {
      failed.push({ symbol, reason: `synthesis failed, existing clip kept: ${error.message}` });
      continue;
    }

    const previous = await resetForRegeneration(assetKey);
    if (!previous) {
      failed.push({ symbol, reason: 'no asset row is registered under that key' });
      continue;
    }

    const result = await produceAsset({
      assetKey,
      storage,
      produce: () => Promise.resolve(produced),
    });

    if (result.status === 'ready') {
      replaced.push({
        symbol,
        from: previous.storageKey,
        to: result.storageKey,
        seconds: produced.info.durationSeconds,
      });
    } else {
      failed.push({ symbol, reason: `${result.status}: ${result.reason ?? ''}` });
    }
  }

  out('');
  for (const row of replaced) {
    out(`  /${row.symbol}/ ${row.seconds.toFixed(3)}s`);
    out(`      was ${row.from}`);
    out(`      now ${row.to}`);
  }
  out(`replaced ${replaced.length}, failed ${failed.length}`);

  for (const row of failed) {
    out(`  - /${row.symbol}/ ${row.reason}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  out('\nThe previous files are still on disk: storage keys are content-addressed,');
  out('so nothing was overwritten and the change can be reversed by hand.');
  out('Run `npm run audio:verify`, then listen again before accepting.');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
