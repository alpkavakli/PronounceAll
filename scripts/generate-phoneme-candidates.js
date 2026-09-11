/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Generate several Piper candidates for one unit, for a maintainer to choose
 * between (audio source policy v1.1; V1, C6, V4, FR-CONTENT-04, D4).
 *
 * `w` and `ɚ` failed the listening pass AND have no isolated-articulation
 * recording on Commons, so neither the synthesis path nor the human path has an
 * answer for them yet. Piper's duration and timbre vary a great deal between
 * draws of the same input, so offering a maintainer a handful of draws is
 * strictly better than replacing one unheard clip with another unheard clip.
 *
 * Candidates are stored as REAL assets — content-addressed, digested, licensed,
 * with full provenance — under a discriminated target (`w#1`, `w#2`, …), which
 * is the use `assetKeyFor`'s `target` parameter already documents. They are NOT
 * referenced by any phoneme, so nothing reaches a learner until
 * `promote-audio-candidates.js` repoints the row.
 *
 * This does not touch the production asset for the unit. If every candidate is
 * rejected, the existing clip stays and the failure is reported rather than
 * papered over.
 *
 * Usage:
 *   node scripts/generate-phoneme-candidates.js w ɚ
 *   node scripts/generate-phoneme-candidates.js w --count 8
 */

import process from 'node:process';

import * as storage from '../src/lib/audio-storage.js';
import { closePool } from '../src/lib/mysql.js';
import { createSynthesiser, loadProfile, preflight } from '../src/lib/piper.js';
import {
  ASSET_KIND,
  assetKeyFor,
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

/** The discriminated target a candidate is stored under. */
export function candidateTarget(symbol, index) {
  return `${symbol}#${index}`;
}

async function main() {
  const variantCode = argValue('--variant') ?? 'en-us';
  const count = Number(argValue('--count') ?? 5);

  const flagValues = new Set([argValue('--variant'), argValue('--count')].filter(Boolean));
  const symbols = process.argv
    .slice(2)
    .filter((argument) => !argument.startsWith('--') && !flagValues.has(argument));

  if (symbols.length === 0) {
    out('Name at least one canonical phoneme, for example:');
    out('  npm run audio:candidates -- w ɚ');
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    out('--count must be an integer between 1 and 20.');
    process.exitCode = 1;
    return;
  }

  const profile = await loadProfile(variantCode);
  const inventory = await loadInventory(variantCode);
  const canonical = new Set(inventory.units.map((unit) => unit.ipaSymbol));
  const byProfile = new Map(profile.units.map((unit) => [unit.ipaSymbol, unit]));

  const unknown = symbols.filter((symbol) => !canonical.has(symbol));
  if (unknown.length > 0) {
    out(`FAIL — not canonical ${variantCode} units: ${unknown.join(' ')}`);
    process.exitCode = 1;
    return;
  }

  const { problems } = await preflight(profile);
  if (problems.length > 0) {
    for (const problem of problems) {
      out(`  - ${problem}`);
    }
    out('FAIL — refusing to generate against a drifted or missing voice.');
    process.exitCode = 1;
    return;
  }

  const variant = await resolveActiveVariant(variantCode);
  const synthesise = createSynthesiser(profile);

  out(`Generating ${count} candidate(s) each for ${symbols.map((s) => `/${s}/`).join(' ')}`);
  out(`Voice ${profile.voice.name}, speaker ${profile.voice.speakerName} (id ${profile.voice.speakerId})`);
  out('');

  const made = [];

  for (const symbol of symbols) {
    const unit = byProfile.get(symbol);

    for (let index = 1; index <= count; index += 1) {
      const target = candidateTarget(symbol, index);
      const assetKey = assetKeyFor({
        kind: ASSET_KIND.PHONEME,
        variantCode,
        target,
        sourceKind: 'tts_piper',
      });

      await registerAsset({
        variantId: variant.variantId,
        assetKey,
        sourceKind: 'tts_piper',
        sourceReference:
          `${profile.engine.package} ${profile.engine.packageVersion} / ${profile.voice.name} / ` +
          `speaker ${profile.voice.speakerName} (id ${profile.voice.speakerId}) / ` +
          `generator ${profile.generatorVersion} / input ${unit.piperInput} / candidate ${index}`,
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
        made.push({ symbol, index, target, storageKey: result.storageKey, seconds: info.durationSeconds });
        out(`  /${symbol}/ #${index}  ${info.durationSeconds.toFixed(3)}s  ${result.storageKey}`);
      } else if (result.status === 'already-ready') {
        out(`  /${symbol}/ #${index}  already generated, left alone`);
      } else {
        out(`  /${symbol}/ #${index}  FAILED ${result.status}: ${result.reason ?? ''}`);
      }
    }
  }

  out('');
  out(`${made.length} candidate(s) generated. None is referenced by any phoneme.`);
  out('Build the review page with `npm run audio:review`, listen, then adopt one');
  out('with `npm run audio:promote -- --piper <symbol> <candidate number>`.');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
