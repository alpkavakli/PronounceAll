/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Derive the machine-readable phoneme inventory from D4 (decision E1, E2,
 * FR-IPA-01).
 *
 * D4 — `docs/current/PronounceAll_en-US_Phoneme_Inventory_v1.md` — is the
 * AUTHORITY for the canonical symbol set and its teaching examples. Code must
 * not carry a second, hand-maintained copy of that list, because two copies
 * drift and the schema would then enforce whichever one the seed happened to
 * read.
 *
 * This script is the one bridge between them: it parses D4's §4 table into
 * `data/seed/<variant>.phonemes.json`, which the ingestion service loads. The
 * artifact is committed like every other seed artifact, so the load stage stays
 * deterministic and touches no document parsing at run time.
 *
 * Run it after any approved change to D4's §4 table; `--check` verifies the
 * committed artifact still matches D4 without writing, which is what CI and the
 * seed validator use to prove the two have not drifted.
 *
 * Usage:
 *   node scripts/extract-phoneme-inventory.js            # write the artifact
 *   node scripts/extract-phoneme-inventory.js --check    # verify only
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const D4_PATH = path.join(
  repoRoot,
  'docs',
  'current',
  'PronounceAll_en-US_Phoneme_Inventory_v1.md',
);

/** The `| 1 | `p` | consonant | pen | /pɛn/ | initial | [pen](url) | notes |` rows of D4 §4. */
const ROW = /^\|\s*(\d+)\s*\|(.+)$/;

/** D4 §2 fixes the three categories and their sizes; the seed asserts them. */
const EXPECTED = Object.freeze({ consonant: 24, vowel: 10, 'central rhotic': 2, diphthong: 5 });

/** @param {string} cell @returns {string} */
function clean(cell) {
  return cell.trim().replace(/^`|`$/g, '');
}

/**
 * Parse D4's §4 teaching-example table.
 *
 * @param {string} markdown the D4 document
 * @returns {object[]} one row per canonical unit, in canonical order
 */
export function parseInventory(markdown) {
  const rows = [];

  for (const line of markdown.split('\n')) {
    const match = ROW.exec(line.trim());
    if (!match) {
      continue;
    }
    const cells = match[2].split('|').map(clean);
    if (cells.length < 7) {
      continue;
    }
    const [ipaUnit, category, exampleWord, exampleIpa, position, source, notes = ''] = cells;

    // The source cell is a markdown link; the URL is the per-row attribution
    // that E2 requires to travel with the example into the database.
    const url = /\((https?:[^)]+)\)/.exec(source);
    if (!url) {
      throw new Error(`D4 row ${match[1]} (${ipaUnit}) has no source URL`);
    }

    rows.push({
      canonicalOrder: Number(match[1]),
      ipaSymbol: ipaUnit.normalize('NFC'),
      category,
      exampleWord,
      // Strip the display slashes; the database stores the transcription bare,
      // exactly as `word_pronunciations.ipa_transcription` does.
      phonemicTranscription: exampleIpa.replace(/^\/|\/$/g, '').normalize('NFC'),
      targetPosition: position.replace(/\*/g, ''),
      sourceReference: url[1],
      notes: notes.trim(),
    });
  }

  return rows;
}

/**
 * @param {object[]} rows
 * @throws {Error} when the parsed table is not the frozen D4 inventory
 */
export function assertInventoryShape(rows) {
  const problems = [];

  const byCategory = {};
  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  }
  for (const [category, count] of Object.entries(EXPECTED)) {
    if (byCategory[category] !== count) {
      problems.push(`category "${category}": expected ${count} units, found ${byCategory[category] ?? 0}`);
    }
  }

  const total = Object.values(EXPECTED).reduce((a, b) => a + b, 0);
  if (rows.length !== total) {
    problems.push(`expected ${total} units, found ${rows.length}`);
  }

  const symbols = rows.map((row) => row.ipaSymbol);
  if (new Set(symbols).size !== symbols.length) {
    problems.push('duplicate ipa_symbol in the D4 table');
  }

  const order = rows.map((row) => row.canonicalOrder);
  if (order.some((value, index) => value !== index + 1)) {
    problems.push('canonical_order is not dense 1..N in document order');
  }

  for (const row of rows) {
    if (!row.exampleWord || !row.phonemicTranscription) {
      problems.push(`${row.ipaSymbol}: missing example word or transcription`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`D4 §4 table is not the frozen inventory:\n  - ${problems.join('\n  - ')}`);
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const variant = 'en-us';

  const markdown = await fs.readFile(D4_PATH, 'utf8');
  const rows = parseInventory(markdown);
  assertInventoryShape(rows);

  const artifact = {
    variant,
    source: 'PronounceAll en-US Pedagogical IPA Inventory v1 (D4)',
    sourceDocument: 'docs/current/PronounceAll_en-US_Phoneme_Inventory_v1.md',
    // The examples are quoted from English Wiktionary; the inventory itself is
    // PronounceAll's own convention.
    exampleSourceLicence: 'CC BY-SA 4.0',
    units: rows,
  };

  const outPath = path.join(repoRoot, 'data', 'seed', `${variant}.phonemes.json`);
  const serialised = `${JSON.stringify(artifact, null, 2)}\n`;

  if (check) {
    const existing = await fs.readFile(outPath, 'utf8').catch(() => null);
    if (existing !== serialised) {
      throw new Error(
        `${outPath} does not match D4. Run: node scripts/extract-phoneme-inventory.js`,
      );
    }
    process.stdout.write(`Inventory artifact matches D4 (${rows.length} units)\n`);
    return;
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, serialised, 'utf8');
  process.stdout.write(`Wrote ${rows.length} canonical units to ${outPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
