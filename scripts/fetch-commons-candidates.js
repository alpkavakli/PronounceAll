/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Fetch Wikimedia Commons replacement candidates (audio source policy v1.1;
 * FR-CONTENT-04/05, E1, C6, V4, NFR-LEGAL-*).
 *
 * The 2026-09-11 listening pass established that Piper cannot synthesise
 * isolated consonants. This stage fetches the human isolated-articulation
 * recordings that will replace the failed units — and does NOT put them into
 * production.
 *
 * What this script guarantees, and what it deliberately does not:
 *
 *   - it stores each candidate as a complete, immutable, content-addressed
 *     asset with digest, byte length, licence, author, source reference and
 *     attribution text, so FR-CONTENT-04 is satisfied the moment it exists;
 *   - it NEVER repoints `phonemes.audio_asset_id`. The production rows keep
 *     pointing at their existing Piper assets until a human approves a
 *     replacement, which `promote-commons-candidates.js` does separately;
 *   - it never deletes or overwrites a Piper asset;
 *   - it makes NO claim that a recording is the correct sound. It cannot: this
 *     project has no decoder and no automated metric for "teaches the right
 *     phoneme". That is the listening pass.
 *
 * Suitability is enforced rather than assumed. A file whose licence is not on
 * the accepted list, or whose author cannot be established at all, is reported
 * and skipped — an unattributable CC BY-SA recording must not be distributed.
 *
 * Usage:
 *   node scripts/fetch-commons-candidates.js --dry-run   # report only, no writes
 *   node scripts/fetch-commons-candidates.js             # fetch and store
 *   node scripts/fetch-commons-candidates.js --only t d  # a subset
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import * as storage from '../src/lib/audio-storage.js';
import {
  attributionFor,
  authorCreditFor,
  download,
  findFirstAvailable,
  unsuitabilityReasons,
  userAgent,
} from '../src/lib/commons.js';
import { closePool } from '../src/lib/mysql.js';
import {
  ASSET_KIND,
  assetKeyFor,
  findByAssetKey,
  produceAsset,
  registerAsset,
} from '../src/services/audio-asset.service.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';

const out = (line) => process.stdout.write(`${line}\n`);
const SOURCE_KIND = 'commons_human';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const variantCode = argValue('--variant') ?? 'en-us';

  const onlyIndex = process.argv.indexOf('--only');
  const only =
    onlyIndex === -1
      ? null
      : new Set(process.argv.slice(onlyIndex + 1).filter((a) => !a.startsWith('--')));

  const manifestPath = path.join('data', 'seed', `${variantCode}.commons-candidates.json`);
  const plan = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  const targets = plan.units.filter((unit) => !only || only.has(unit.ipaSymbol));
  out(`Commons candidates for ${variantCode}: ${targets.length} unit(s)`);
  out(`User-Agent: ${userAgent}`);
  out('');

  const variant = await resolveActiveVariant(variantCode);
  const found = [];
  const unusable = [];
  const missing = [];

  for (const unit of targets) {
    const described = await findFirstAvailable(unit.candidates);

    if (!described) {
      missing.push({ symbol: unit.ipaSymbol, tried: unit.candidates });
      out(`  /${unit.ipaSymbol}/  NOT FOUND — tried ${unit.candidates.join(', ')}`);
      continue;
    }

    const problems = unsuitabilityReasons(described);
    if (problems.length > 0) {
      unusable.push({ symbol: unit.ipaSymbol, described, problems });
      out(`  /${unit.ipaSymbol}/  UNSUITABLE — ${problems.join('; ')}`);
      continue;
    }

    found.push({ unit, described });
    const duration = described.durationSeconds ? `${described.durationSeconds.toFixed(2)}s` : '—';
    out(
      `  /${unit.ipaSymbol}/  ${described.fileName}  ${duration}  ${described.licenceName}  ` +
        `${described.authorBasis}: ${authorCreditFor(described)}`,
    );
  }

  if (dryRun) {
    out(`\nDry run: ${found.length} usable, ${unusable.length} unsuitable, ${missing.length} missing.`);
    out('Nothing was downloaded or stored.');
    return;
  }

  out(`\nDownloading and storing ${found.length} candidate(s) as UNPROMOTED assets`);
  const stored = [];
  const failed = [];

  for (const { unit, described } of found) {
    const assetKey = assetKeyFor({
      kind: ASSET_KIND.PHONEME,
      variantCode,
      target: unit.ipaSymbol,
      sourceKind: SOURCE_KIND,
    });

    try {
      // registerAsset refuses a human recording with no source reference or no
      // author, so provenance is complete before a byte is written.
      await registerAsset({
        variantId: variant.variantId,
        assetKey,
        sourceKind: SOURCE_KIND,
        sourceReference: described.pageUrl,
        author: authorCreditFor(described),
        licenceIdentifier: described.licenceIdentifier,
        licenceUrl: described.licenceUrl,
        attributionText: attributionFor(described),
        retrievedAt: new Date().toISOString().slice(0, 10),
      });

      const existing = await findByAssetKey(assetKey);
      if (existing?.generationStatus === 'ready') {
        out(`  /${unit.ipaSymbol}/ already fetched, left alone`);
        stored.push({ symbol: unit.ipaSymbol, assetKey, storageKey: existing.storageKey, reused: true });
        continue;
      }

      const result = await produceAsset({
        assetKey,
        storage,
        produce: async () => ({
          bytes: await download(described),
          mimeType: described.mimeType,
        }),
      });

      if (result.status === 'ready') {
        stored.push({ symbol: unit.ipaSymbol, assetKey, storageKey: result.storageKey });
        out(`  /${unit.ipaSymbol}/ stored ${result.storageKey}`);
      } else {
        failed.push({ symbol: unit.ipaSymbol, reason: `${result.status}: ${result.reason ?? ''}` });
        out(`  /${unit.ipaSymbol}/ FAILED ${result.status}: ${result.reason ?? ''}`);
      }
    } catch (error) {
      failed.push({ symbol: unit.ipaSymbol, reason: error.message });
      out(`  /${unit.ipaSymbol}/ FAILED ${error.message}`);
    }
  }

  out('');
  out(`stored ${stored.length}, failed ${failed.length}, unsuitable ${unusable.length}, missing ${missing.length}`);

  for (const row of unusable) {
    out(`  UNSUITABLE /${row.symbol}/: ${row.problems.join('; ')}`);
  }
  for (const row of missing) {
    out(`  MISSING /${row.symbol}/: tried ${row.tried.join(', ')}`);
  }

  out('');
  out('NOTHING IS IN PRODUCTION YET. Every phoneme still points at its existing');
  out('asset. Build the review page with `npm run audio:review`, listen, then');
  out('promote only what you approve with `npm run audio:promote -- <symbols>`.');

  if (failed.length > 0 || missing.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
