/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The seed entry point (decision E1, FR-CONTENT-01, FR-WORD-10).
 *
 * E1 puts the one-off import ENTRY POINT in `scripts/` and the reusable
 * normalise, validate, and load logic in `services/`, so this file is
 * deliberately thin: it reads the committed artifact, resolves the variant,
 * calls the ingestion service, prints the report, and purges the edge cache for
 * the pages it changed.
 *
 * It touches no network for content: the fetch stage already ran and its
 * artifact is committed, which is what makes the run deterministic and
 * reproducible from a documented command (FR-CONTENT-01). Re-running converges
 * rather than duplicating, because the loader upserts on natural keys.
 *
 * Usage:
 *   node scripts/seed-words.js                 # load
 *   node scripts/seed-words.js --dry-run       # validate and diff only
 *   node scripts/seed-words.js --variant en-us
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config/index.js';
import { createCloudflarePurger, createUnconfiguredPurger } from '../src/lib/cache-purge.js';
import { closePool } from '../src/lib/mysql.js';
import { SHELL_EDGE_TTL_SECONDS } from '../src/middleware/response-class.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import { ingestArtifact } from '../src/services/word-ingestion.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/**
 * @param {string} file
 * @returns {Promise<object | null>}
 */
async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const variantCode = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'en-us';

  const seedDir = path.join(repoRoot, 'data', 'seed');
  const artifact = await readJsonIfPresent(path.join(seedDir, `${variantCode}.raw.json`));
  if (!artifact) {
    throw new Error(
      `No ingestion artifact for "${variantCode}". Run: node scripts/fetch-wiktionary.js --variant ${variantCode}`,
    );
  }

  // Maintainer overrides, applied by the normalise stage. Optional: the
  // pipeline runs without it, and it exists so a review decision is recorded as
  // committed data rather than as an edit to fetched content.
  const curation =
    (await readJsonIfPresent(path.join(seedDir, `${variantCode}.curation.json`)))?.words ?? {};

  const variant = await resolveActiveVariant(variantCode);
  if (!variant) {
    throw new Error(
      `Variant "${variantCode}" is absent or inactive in language_variants (FR-CONTENT-06).`,
    );
  }

  const report = await ingestArtifact(artifact, {
    variantId: variant.variantId,
    curation,
    dryRun,
  });

  const out = process.stdout;
  out.write(`\n${dryRun ? 'DRY RUN — nothing was written' : 'Seed complete'}\n`);
  out.write(`  variant       ${variant.code} (${variant.displayName})\n`);
  out.write(`  loaded        ${report.loaded.length}\n`);
  out.write(`  rejected      ${report.rejected.length}\n`);
  out.write(`  with warnings ${report.warned.length}\n`);

  if (report.rejected.length > 0) {
    out.write('\nRejected — these entries were NOT written:\n');
    for (const item of report.rejected) {
      out.write(`  ${item.headword}\n`);
      for (const problem of item.problems) {
        out.write(`      ${problem}\n`);
      }
    }
  }

  if (report.warned.length > 0) {
    out.write('\nWarnings — written, but the syllable breakdown is coarser than\n');
    out.write('the upstream hyphenation. Add an override to the curation file to fix:\n');
    for (const item of report.warned) {
      out.write(`  ${item.headword}\n`);
      for (const warning of item.warnings) {
        out.write(`      ${warning}\n`);
      }
    }
  }

  // SDD §6.3: the word-page shell is edge-cached, so a re-seed purges the URLs
  // it changed. Iteration 1 ships the seam; credentials arrive with the
  // production-edge work, and an unconfigured seam purges nothing and says so
  // rather than pretending (Handoff §8.5).
  if (!dryRun && report.loaded.length > 0) {
    const purge = config.cloudflareCachePurge.isConfigured
      ? createCloudflarePurger(config.cloudflareCachePurge)
      : createUnconfiguredPurger(SHELL_EDGE_TTL_SECONDS);

    await purge(
      report.loaded.map(
        (item) => `${config.baseUrl}/${variant.code}/${encodeURIComponent(item.headword)}`,
      ),
    );
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
