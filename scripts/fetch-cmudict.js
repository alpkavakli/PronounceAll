/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Fetch the pinned CMU Pronouncing Dictionary entries curation relies on (E1,
 * D4 §5.8, FR-CONTENT-01).
 *
 * CMUdict is admitted only through `<variant>.curation.json` `cmudict` pins,
 * so this stage fetches only the headwords those pins name. The upstream file
 * is read at ONE pinned commit and must match its recorded SHA-256, so a
 * rebuild never depends on whatever copy happens to sit in `tools/validation`
 * or on upstream having moved.
 *
 * It writes:
 *   - `data/seed/<variant>.cmudict.json`: dataset-level provenance (commit,
 *     URLs, checksum, licence, retrieval date) and the raw ARPABET lines for the
 *     pinned headwords. Raw notation lives here, not in a runtime column
 *     (SDD §4.12).
 *   - `data/seed/licences/cmudict-LICENSE.txt`: the licence text at that commit,
 *     retained verbatim as its first clause requires.
 *
 * Usage:
 *   node scripts/fetch-cmudict.js [--variant en-us]
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', 'data', 'seed');

const REPOSITORY = 'https://github.com/cmusphinx/cmudict';
const COMMIT = '74790861f652b15e4ac49015a90074ad62a27690';
const DICT_SHA256 = '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22';
const RAW = `https://raw.githubusercontent.com/cmusphinx/cmudict/${COMMIT}`;

/**
 * The licence is BSD-2-Clause in structure but not an exact SPDX match: it adds
 * "The contents of this file are deemed to be source code." and a funding
 * acknowledgement. It is therefore recorded as a LicenseRef, with the verbatim
 * text kept alongside, rather than claimed as `BSD-2-Clause`.
 */
const LICENCE_IDENTIFIER = 'LicenseRef-CMUdict';

const USER_AGENT = 'PronounceAll-seed/0.1 (https://github.com/alpkavakli/PronounceAll; content seeding)';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function download(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const args = process.argv.slice(2);
  const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'en-us';

  const curation = JSON.parse(await fs.readFile(path.join(seedDir, `${variant}.curation.json`), 'utf8'));
  const headwords = Object.entries(curation.words)
    .filter(([, entry]) => Array.isArray(entry.cmudict))
    .map(([headword]) => headword)
    .sort();

  const dict = await download(`${RAW}/cmudict.dict`);
  const digest = sha256(dict);
  if (digest !== DICT_SHA256) {
    throw new Error(`cmudict.dict at ${COMMIT} has SHA-256 ${digest}, expected ${DICT_SHA256}`);
  }
  const licence = await download(`${RAW}/LICENSE`);

  // `word(2)` marks a variant of `word`; a trailing `# comment` is not a phone.
  const wanted = new Set(headwords);
  const entries = Object.fromEntries(headwords.map((headword) => [headword, []]));
  dict
    .toString('utf8')
    .split('\n')
    .forEach((line, index) => {
      const [word, ...phones] = line.split('#')[0].trim().split(/\s+/);
      const headword = word?.replace(/\(\d\)$/, '');
      // The 1-based line number makes each row's source reference an exact
      // anchor into the pinned file.
      if (phones.length > 0 && wanted.has(headword)) {
        entries[headword].push({ arpabet: phones.join(' '), line: index + 1 });
      }
    });

  const missing = headwords.filter((headword) => entries[headword].length === 0);
  if (missing.length > 0) throw new Error(`absent from CMUdict at ${COMMIT}: ${missing.join(', ')}`);

  const artifact = {
    variant,
    source: 'CMU Pronouncing Dictionary',
    sourceUrl: REPOSITORY,
    commit: COMMIT,
    fileUrl: `${REPOSITORY}/blob/${COMMIT}/cmudict.dict`,
    fileSha256: digest,
    licenceIdentifier: LICENCE_IDENTIFIER,
    licenceUrl: `${REPOSITORY}/blob/${COMMIT}/LICENSE`,
    licenceText: 'data/seed/licences/cmudict-LICENSE.txt',
    licenceSha256: sha256(licence),
    retrievedAt: new Date().toISOString().slice(0, 10),
    entries,
  };

  await fs.mkdir(path.join(seedDir, 'licences'), { recursive: true });
  await fs.writeFile(path.join(seedDir, 'licences', 'cmudict-LICENSE.txt'), licence);
  await fs.writeFile(path.join(seedDir, `${variant}.cmudict.json`), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${headwords.length} CMUdict entr${headwords.length === 1 ? 'y' : 'ies'} at ${COMMIT}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
