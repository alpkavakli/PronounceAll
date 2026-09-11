/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The canonical phoneme audio batch (V1, C6, V4, FR-CONTENT-02/04, D4).
 *
 * E1 puts the one-off entry point in `scripts/` and the reusable logic in
 * `services/` and `lib/`, so this file is thin: it loads the approved profile,
 * refuses to run if the installed voice has drifted from it, and then walks the
 * canonical inventory through the EXISTING claim -> produce -> finalise
 * pipeline. There is deliberately no parallel generation path: `produceAsset`
 * owns the atomic claim, the content-addressed store and the `ready` transition,
 * and this script only supplies the `produce` function (C4).
 *
 * The asset keys are the ones `seed-phonemes` already registered. The batch
 * re-registers provenance for each unit before producing it, because V1 requires
 * the generator, voice, speaker and version to be recorded on the row, and
 * `upsertPending` refreshes provenance without touching `generation_status`.
 *
 * Usage:
 *   node scripts/generate-phoneme-audio.js --dry-run   # preflight only
 *   node scripts/generate-phoneme-audio.js             # generate
 *   node scripts/generate-phoneme-audio.js --only ɝ    # one unit
 */

import process from 'node:process';

import * as storage from '../src/lib/audio-storage.js';
import { closePool } from '../src/lib/mysql.js';
import { createSynthesiser, loadProfile, preflight, resolveTooling } from '../src/lib/piper.js';
import {
  ASSET_KIND,
  assetKeyFor,
  GENERATOR_VERSION,
  PIPER_VOICE,
  produceAsset,
  registerAsset,
} from '../src/services/audio-asset.service.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { loadInventory } from '../src/services/ipa-tokenization.service.js';

const out = (line) => process.stdout.write(`${line}\n`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * The provenance V1 requires on a generated asset.
 *
 * `source_reference` is the reproduction recipe, not learner-facing text; the
 * learner-facing string is `attribution_text`.
 *
 * @param {object} profile
 * @param {object} unit
 * @returns {string}
 */
function sourceReferenceFor(profile, unit) {
  return [
    `${profile.engine.package} ${profile.engine.packageVersion}`,
    profile.voice.name,
    `speaker ${profile.voice.speakerName} (id ${profile.voice.speakerId})`,
    `profile ${profile.profileVersion}`,
    `generator ${profile.generatorVersion}`,
    `input ${unit.piperInput}`,
  ].join(' / ');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const only = argValue('--only');
  const variantCode = argValue('--variant') ?? 'en-us';

  const profile = await loadProfile(variantCode);
  out(`Profile ${profile.profileVersion} — ${profile.units.length} units`);
  out(`Engine  ${profile.engine.package} ${profile.engine.packageVersion}, ${profile.engine.inputMechanism}`);
  out(`Voice   ${profile.voice.name}, speaker ${profile.voice.speakerName} (id ${profile.voice.speakerId})`);

  // ---- The asset keys must be the ones already registered ------------------
  // The key embeds the voice and generator version, so a profile that disagreed
  // with the code constants would generate NEW keys and silently strand the 41
  // rows the seed created.
  if (profile.voice.name !== PIPER_VOICE || profile.generatorVersion !== GENERATOR_VERSION) {
    out(
      `\nFAIL — profile voice/generator (${profile.voice.name}/${profile.generatorVersion}) does not match ` +
        `the asset-key constants (${PIPER_VOICE}/${GENERATOR_VERSION}). Generating would strand the seeded rows.`,
    );
    process.exitCode = 1;
    return;
  }

  // ---- Preflight, fail closed ---------------------------------------------
  out('\nPreflight');
  const tooling = resolveTooling(profile);
  out(`  tooling ${tooling.python}`);
  const { problems, checkedCodepoints } = await preflight(profile);

  if (problems.length > 0) {
    out(`  ${problems.length} PROBLEM(S):`);
    for (const problem of problems) {
      out(`    - ${problem}`);
    }
    out('\nFAIL — refusing to generate against a drifted or missing voice.');
    process.exitCode = 1;
    return;
  }
  out(`  voice files present, digests match the pinned values`);
  out(`  speaker ${profile.voice.speakerName} resolves to id ${profile.voice.speakerId}`);
  out(`  ${checkedCodepoints} required codepoints all present in phoneme_id_map`);

  // ---- The canonical inventory is the work list ---------------------------
  const inventory = await loadInventory(variantCode);
  const bySymbol = new Map(profile.units.map((unit) => [unit.ipaSymbol, unit]));

  const uncovered = inventory.units.filter((unit) => !bySymbol.has(unit.ipaSymbol));
  if (uncovered.length > 0) {
    out(`\nFAIL — the profile does not cover ${uncovered.length} canonical unit(s): ${uncovered.map((u) => u.ipaSymbol).join(' ')}`);
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    out('\nDry run: preflight passed, nothing generated.');
    return;
  }

  const variant = await resolveActiveVariant(variantCode);
  const synthesise = createSynthesiser(profile);

  const work = inventory.units.filter((unit) => only === undefined || unit.ipaSymbol === only);
  if (work.length === 0) {
    out(`\nFAIL — no canonical unit matches --only ${only}`);
    process.exitCode = 1;
    return;
  }

  out(`\nGenerating ${work.length} asset(s)`);
  const results = { ready: 0, alreadyReady: 0, skipped: 0, failed: [] };

  for (const canonical of work) {
    const unit = bySymbol.get(canonical.ipaSymbol);
    const assetKey = assetKeyFor({
      kind: ASSET_KIND.PHONEME,
      variantCode,
      target: canonical.ipaSymbol,
      sourceKind: 'tts_piper',
    });

    // Refresh provenance on the row the seed registered (V1). This never
    // touches generation_status, so it cannot resurrect or claim anything.
    await registerAsset({
      variantId: variant.variantId,
      assetKey,
      sourceKind: 'tts_piper',
      sourceReference: sourceReferenceFor(profile, unit),
      licenceIdentifier: 'CC-BY-SA-4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attributionText: 'Synthesised with Piper (en_US-libritts-high); voice trained on LibriTTS (CC BY 4.0).',
      retrievedAt: new Date().toISOString().slice(0, 10),
    });

    let info;
    const result = await produceAsset({
      assetKey,
      storage,
      produce: async () => {
        const produced = await synthesise(unit);
        info = produced.info;
        return produced;
      },
    });

    if (result.status === 'ready') {
      results.ready += 1;
      out(
        `  /${canonical.ipaSymbol}/ ${unit.piperInput} -> ${info.durationSeconds.toFixed(3)}s ` +
          `peak ${info.peak} ${result.storageKey}`,
      );
    } else if (result.status === 'already-ready') {
      results.alreadyReady += 1;
      out(`  /${canonical.ipaSymbol}/ already ready, left alone (V4: a produced asset is immutable)`);
    } else if (result.status === 'failed') {
      results.failed.push({ symbol: canonical.ipaSymbol, reason: result.reason });
      out(`  /${canonical.ipaSymbol}/ FAILED: ${result.reason}`);
    } else {
      results.skipped += 1;
      out(`  /${canonical.ipaSymbol}/ ${result.status}: ${result.reason}`);
    }
  }

  out('');
  out(`generated ${results.ready}, already ready ${results.alreadyReady}, skipped ${results.skipped}, failed ${results.failed.length}`);

  if (results.failed.length > 0) {
    out('\nFailed units remain claimable and can be re-run:');
    for (const failure of results.failed) {
      out(`  - /${failure.symbol}/ ${failure.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  out('\nRun `npm run audio:verify` to confirm coverage and integrity.');
  out('The generated batch still needs a maintainer listening pass before the');
  out('AUDIO CONTENT is pedagogically approved. This script does not assert that.');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
