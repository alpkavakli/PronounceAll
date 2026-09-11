/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The whole-word TTS batch (FR-CONTENT-03, FR-IPA-05 tier 2, V1, C6, V4,
 * SDD §4.12 / D-R3-08).
 *
 * FR-CONTENT-03: every seeded word lacking a Wiktionary human recording holds a
 * pre-generated TTS asset, produced once by the seed pipeline. No seeded word
 * currently has a human recording, so this batch covers all of them; when
 * recordings are ingested they take tier 1 and this batch simply finds less to
 * do.
 *
 * The input here is the word's SPELLING, which is ordinary TTS use and needs no
 * per-unit mapping — unlike the isolated phoneme clips, where feeding Piper a
 * bare IPA character would produce a letter name. The phoneme profile's raw
 * injection is deliberately NOT used for words.
 *
 * Why primary pronunciations only. D-R3-08 gives a secondary pronunciation an
 * audio control only when an asset is known to correspond to THAT pronunciation,
 * and forbids reusing the primary's audio for it. A clip synthesised from the
 * spelling is one rendering with no guarantee about which reading it matches,
 * so it is attached to the primary pronunciation and to nothing else. A
 * heteronym's secondary reading therefore keeps no control, which is the
 * specified behaviour rather than a gap.
 *
 * Usage:
 *   node scripts/generate-word-audio.js --dry-run      # report the work list
 *   node scripts/generate-word-audio.js --limit 25     # a sample
 *   node scripts/generate-word-audio.js                # everything outstanding
 */

import process from 'node:process';

import * as storage from '../src/lib/audio-storage.js';
import { closePool } from '../src/lib/mysql.js';
import { createBatchSynthesiser, createSynthesiser, loadProfile, preflight } from '../src/lib/piper.js';
import {
  attachWholeWordAudio,
  listPrimaryPronunciationsWithoutAudio,
} from '../src/repositories/words.repository.js';
import {
  ASSET_KIND,
  assetKeyFor,
  findByAssetKey,
  GENERATOR_VERSION,
  PIPER_VOICE,
  produceAsset,
  registerAsset,
} from '../src/services/audio-asset.service.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';

const out = (line) => process.stdout.write(`${line}\n`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limit = argValue('--limit') ? Number(argValue('--limit')) : undefined;
  const chunkSize = argValue('--chunk') ? Number(argValue('--chunk')) : 200;
  const variantCode = argValue('--variant') ?? 'en-us';

  const profile = await loadProfile(variantCode);

  if (profile.voice.name !== PIPER_VOICE || profile.generatorVersion !== GENERATOR_VERSION) {
    out('FAIL — profile voice/generator does not match the asset-key constants.');
    process.exitCode = 1;
    return;
  }

  const { problems } = await preflight(profile);
  if (problems.length > 0) {
    out('Preflight PROBLEM(S):');
    for (const problem of problems) {
      out(`  - ${problem}`);
    }
    out('\nFAIL — refusing to generate against a drifted or missing voice.');
    process.exitCode = 1;
    return;
  }
  out(`Preflight passed — ${profile.voice.name}, speaker ${profile.voice.speakerName}`);

  const variant = await resolveActiveVariant(variantCode);
  const outstanding = await listPrimaryPronunciationsWithoutAudio(variant.variantId);
  out(`${outstanding.length} primary pronunciation(s) without whole-word audio`);

  if (dryRun) {
    out('\nDry run. First 10:');
    for (const row of outstanding.slice(0, 10)) {
      out(`  ${row.displayHeadword}`);
    }
    return;
  }

  const work = limit ? outstanding.slice(0, limit) : outstanding;
  out(`Generating ${work.length}`);

  const synthesise = createSynthesiser(profile);
  const synthesiseBatch = createBatchSynthesiser(profile);
  const started = Date.now();
  const results = { ready: 0, attached: 0, failed: [] };
  let done = 0;

  for (let offset = 0; offset < work.length; offset += chunkSize) {
    const chunk = work.slice(offset, offset + chunkSize);

    // One Piper invocation for the whole chunk: the model load is the cost, and
    // paying it per word turns minutes into hours.
    const audio = await synthesiseBatch(
      chunk.map((row) => ({ id: row.normalizedHeadword, text: row.displayHeadword })),
    );

    for (const row of chunk) {
      const assetKey = assetKeyFor({
        kind: ASSET_KIND.WORD,
        variantCode,
        target: row.normalizedHeadword,
        sourceKind: 'tts_piper',
      });

      await registerAsset({
        variantId: variant.variantId,
        assetKey,
        sourceKind: 'tts_piper',
        sourceReference:
          `${profile.engine.package} ${profile.engine.packageVersion} / ${profile.voice.name} / ` +
          `speaker ${profile.voice.speakerName} (id ${profile.voice.speakerId}) / ` +
          `generator ${profile.generatorVersion} / input ${row.displayHeadword}`,
        licenceIdentifier: 'CC-BY-SA-4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        attributionText: 'Synthesised with Piper (en_US-libritts-high); voice trained on LibriTTS (CC BY 4.0).',
        retrievedAt: new Date().toISOString().slice(0, 10),
      });

      const prepared = audio.get(row.normalizedHeadword);
      const result = await produceAsset({
        assetKey,
        storage,
        // Ordinary TTS over the spelling. No raw phoneme injection here.
        // Anything the chunk did not yield is retried on its own rather than
        // silently dropped.
        produce: () => (prepared ? Promise.resolve(prepared) : synthesise({ piperInput: row.displayHeadword })),
      });

      if (result.status === 'failed') {
        results.failed.push({ headword: row.displayHeadword, reason: result.reason });
      } else {
        if (result.status === 'ready') {
          results.ready += 1;
        }
        // Link the pronunciation only once the asset really exists.
        const asset = await findByAssetKey(assetKey);
        if (asset?.generationStatus === 'ready') {
          await attachWholeWordAudio(row.pronunciationId, asset.audioAssetId);
          results.attached += 1;
        }
      }
      done += 1;
    }

    const elapsed = (Date.now() - started) / 1000;
    const rate = done / elapsed;
    out(
      `  ${done}/${work.length}  ${rate.toFixed(1)}/s  ` +
        `~${Math.round((work.length - done) / rate / 60)} min remaining  failed ${results.failed.length}`,
    );
  }

  out('');
  out(`generated ${results.ready}, attached ${results.attached}, failed ${results.failed.length}`);

  for (const failure of results.failed.slice(0, 20)) {
    out(`  - ${failure.headword}: ${failure.reason}`);
  }
  if (results.failed.length > 0) {
    out('\nFailed assets stay claimable, so re-running retries exactly those.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
