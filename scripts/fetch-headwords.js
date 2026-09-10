/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Fetch the ranked headword source (FR-WORD-10, FR-CONTENT-01, decision E1).
 *
 * FR-WORD-10 requires at least 5 000 common American-English headwords at
 * launch. Choosing them by hand is neither possible nor desirable, so the
 * selection comes from a frequency ranking and only the *selection* comes from
 * there — meaning, IPA, and attribution continue to come from the approved
 * Wiktionary entry path (`fetch-wiktionary.js`).
 *
 * The ranking is English Wiktionary's own TV/movie-subtitle frequency lists,
 * ranks 1 to 10 000. Same upstream, same CC BY-SA 4.0 reuse path already taken
 * for meanings and pronunciations, so no second licence question arises. A
 * subtitle corpus also suits a learner-facing pronunciation tool better than a
 * written corpus: it is the vocabulary of speech.
 *
 * Output is `data/seed/<variant>.headwords.json`, committed, so headword
 * SELECTION is reproducible without re-reading ten wiki pages.
 *
 * Usage:
 *   node scripts/fetch-headwords.js
 *   node scripts/fetch-headwords.js --variant en-us
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const API = 'https://en.wiktionary.org/w/api.php';

/**
 * Wikimedia asks automated clients to identify themselves and to stay polite.
 * https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
 */
const USER_AGENT =
  'PronounceAll-seed/0.1 (https://github.com/alpkavakli/PronounceAll; content seeding)';

const FREQUENCY_PAGE_PREFIX = 'Wiktionary:Frequency lists/TV/2006/';
const HIGHEST_RANK = 10000;
const RANKS_PER_PAGE = 1000;

const SOURCE_LICENCE = 'CC BY-SA 4.0';

/** Table rows read `| <rank>  || [[word#English|word]]  || <count>`. */
const FREQUENCY_ROW = /^\|\s*(\d+)\s*\|\|\s*\[\[([^\]|#]+)/;

/**
 * The en-us slug allow-list of FR-WORD-02. A ranked entry that cannot be a slug
 * cannot be a word page, so it is dropped at selection rather than failing later
 * in the pipeline. This removes numerals, and proper nouns keep their case in
 * the source so they largely fall out here too.
 */
const SLUG_SHAPE = /^[a-z'-]+$/;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} title
 * @returns {Promise<string>} page wikitext
 */
async function pageContent(title) {
  const url = `${API}?${new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    rvslots: 'main',
    rvprop: 'content',
    titles: title,
    format: 'json',
    formatversion: '2',
  })}`;

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`"${title}" returned HTTP ${response.status}`);
  }
  const body = await response.json();
  const page = body.query.pages[0];
  if (page.missing) {
    throw new Error(`Frequency page "${title}" does not exist`);
  }
  return page.revisions[0].slots.main.content;
}

async function main() {
  const args = process.argv.slice(2);
  const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'en-us';

  const ranked = [];
  const seen = new Set();
  const sourceUrls = [];
  let dropped = 0;

  for (let low = 1; low <= HIGHEST_RANK; low += RANKS_PER_PAGE) {
    const range = `${low}-${low + RANKS_PER_PAGE - 1}`;
    const title = `${FREQUENCY_PAGE_PREFIX}${range}`;
    sourceUrls.push(`https://en.wiktionary.org/wiki/${encodeURI(title.replace(/ /g, '_'))}`);

    const content = await pageContent(title);
    let kept = 0;
    for (const line of content.split('\n')) {
      const match = FREQUENCY_ROW.exec(line.trim());
      if (!match) {
        continue;
      }
      const word = match[2].trim().toLowerCase();
      if (!SLUG_SHAPE.test(word)) {
        dropped += 1;
        continue;
      }
      // A word can appear more than once across the tables; the most common
      // occurrence wins, and the tables are read in ascending rank order.
      if (seen.has(word)) {
        continue;
      }
      seen.add(word);
      ranked.push({ rank: Number(match[1]), word });
      kept += 1;
    }
    process.stdout.write(`  . ${range}  kept ${kept}\n`);
    await sleep(200);
  }

  ranked.sort((a, b) => a.rank - b.rank);

  const outPath = path.join(repoRoot, 'data', 'seed', `${variant}.headwords.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    `${JSON.stringify(
      {
        variant,
        source: 'English Wiktionary — TV/movie frequency lists (2006), ranks 1–10000',
        sourceUrls,
        sourceLicence: SOURCE_LICENCE,
        note:
          'Selection source only. Meanings, pronunciations, and per-word attribution come from the Wiktionary entry path.',
        fetchedAt: new Date().toISOString(),
        ranked,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  process.stdout.write(
    `\nWrote ${ranked.length} ranked headwords to ${outPath}\n` +
      `Dropped ${dropped} entries that cannot be en-us slugs (numerals, proper nouns, punctuation).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
