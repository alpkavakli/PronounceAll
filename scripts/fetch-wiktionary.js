/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Seed pipeline, stage 1 of 4: FETCH (decision E1, FR-CONTENT-01).
 *
 * E1 fixes a staged, variant-parameterised, idempotent pipeline of fetch,
 * normalise, validate, and load. This script is the fetch stage and the ONLY
 * stage that touches the network.
 *
 * It writes a raw ingestion ARTIFACT rather than loading anything. That split
 * is what makes FR-CONTENT-01's determinism requirement satisfiable: an
 * upstream wiki changes under you, so a pipeline that fetched at load time
 * could not produce the launch dataset deterministically. The artifact is
 * reviewed, curated, and committed; `seed-words.js` then loads from it offline
 * and reproducibly. The artifact is also where SDD §4.12 says raw upstream IPA
 * and other source notation is preserved, rather than as a runtime column.
 *
 * Iteration 1 Handoff §8.4 fixes English Wiktionary as the source and takes the
 * CC BY-SA 4.0 reuse path. Per that section this fetches meanings, pronunciation
 * data, and attribution ONLY — no quotations, no usage examples, and no media,
 * because embedded media on Wiktionary may carry separate terms.
 *
 * Usage:
 *   node scripts/fetch-wiktionary.js [--variant en-us] [--out <path>]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { selectHeadwords } from './seed-headwords.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const API = 'https://en.wiktionary.org/w/api.php';

/**
 * Wikimedia asks automated clients to identify themselves and to stay polite.
 * https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
 */
const USER_AGENT =
  'PronounceAll-seed/0.1 (https://github.com/alpkavakli/PronounceAll; content seeding)';

/** Delay between requests, in milliseconds. Deliberately unhurried. */
const REQUEST_INTERVAL_MS = 250;

/**
 * Titles per request. 50 is the MediaWiki limit for ordinary clients, and using
 * it turns a 6 500-word fetch into ~130 requests rather than 6 500. Combined
 * with the interval above this stays well inside what Wikimedia asks of
 * automated clients, while finishing in about a minute instead of half an hour.
 */
const BATCH_SIZE = 50;

/** Wiktionary's licence for original entry text (Handoff §8.4). */
const SOURCE_LICENCE = 'CC BY-SA 4.0';

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetch up to 50 pages in one request.
 *
 * The MediaWiki API accepts 50 titles per query for ordinary clients, so 6 500
 * headwords cost ~130 requests rather than 6 500. That is the difference
 * between a polite fetch and one that hammers Wikimedia, and it is why the
 * expansion is practical at all.
 *
 * Titles are returned under their NORMALISED form, and the API may resolve a
 * title differently from what was asked, so results are matched back through
 * the `normalized` map rather than by position.
 *
 * @param {string[]} titles at most 50
 * @returns {Promise<Map<string, {wikitext: string, revisionId: number} | null>>}
 *   keyed by the REQUESTED title
 */
async function fetchBatch(titles) {
  const url =
    `${API}?action=query&prop=revisions&rvprop=content|ids&rvslots=main` +
    `&titles=${titles.map((t) => encodeURIComponent(t)).join('|')}` +
    '&format=json&formatversion=2';

  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Wiktionary returned HTTP ${response.status} for a batch of ${titles.length}`);
  }
  const payload = await response.json();

  // `from` is what we asked for, `to` what the API resolved it to.
  const requestedFor = new Map();
  for (const entry of payload?.query?.normalized ?? []) {
    requestedFor.set(entry.to, entry.from);
  }

  const byTitle = new Map();
  for (const page of payload?.query?.pages ?? []) {
    const requested = requestedFor.get(page.title) ?? page.title;
    byTitle.set(
      requested,
      page.missing || !page.revisions?.[0]
        ? null
        : {
            wikitext: page.revisions[0].slots.main.content,
            revisionId: page.revisions[0].revid,
          },
    );
  }

  // A title the response never mentioned is absent rather than silently lost.
  for (const title of titles) {
    if (!byTitle.has(title)) {
      byTitle.set(title, null);
    }
  }
  return byTitle;
}

/**
 * Isolate the `==English==` section. Wiktionary holds every language's entry for
 * a spelling on one page, so taking the whole page would mix, say, the Spanish
 * `banana` into an American English dictionary.
 *
 * @param {string} wikitext
 * @returns {string | null}
 */
function englishSection(wikitext) {
  // `^` as well as a newline: many entries open with `==English==` on line 1.
  const match = wikitext.match(/(?:^|\n)==\s*English\s*==\s*\n([\s\S]*?)(?=\n==[^=]|$)/);
  return match ? match[1] : null;
}

/**
 * Every Pronunciation section in the English entry. A heteronym such as `lead`
 * carries one per etymology, which is exactly the many-pronunciations-per-word
 * case `word_pronunciations` exists to hold (E4).
 *
 * @param {string} english
 * @returns {string[]}
 */
function pronunciationSections(english) {
  return [
    ...english.matchAll(/(?:^|\n)=+\s*Pronunciation\s*\d*\s*=+\s*\n([\s\S]*?)(?=\n=+[^=]|$)/g),
  ].map((match) => match[1]);
}

/**
 * Extract phonemic transcriptions with the accent labels that qualify them.
 *
 * The accent qualifier is read from the whole LINE rather than from the `IPA`
 * template alone, because Wiktionary frequently puts it on a neighbouring
 * `enPR` template on the same bullet — `record` is written that way, with
 * `a=GA` on the `enPR` and the General American IPA beside it carrying none.
 *
 * Only `/slashed/` phonemic transcriptions are taken. `[bracketed]` phonetic
 * realisations are narrower than the pedagogical transcription this project
 * displays, and mixing the two would produce an inconsistent dictionary.
 *
 * @param {string} section
 * @returns {Array<{ ipa: string, accents: string[] }>}
 */
function extractTranscriptions(section) {
  const found = [];

  for (const line of section.split('\n')) {
    if (!line.trimStart().startsWith('*')) {
      continue;
    }

    const accents = [...line.matchAll(/\|a=([^|}]*)/g)]
      .flatMap((match) => match[1].split(','))
      .map((accent) => accent.trim().replace(/]+$/, ''))
      .filter(Boolean);

    for (const template of line.matchAll(/\{\{IPA\|en\|([^}]*)\}\}/g)) {
      for (const parameter of template[1].split('|')) {
        const value = parameter.trim();
        // Positional parameters only: a named one is metadata, not a
        // transcription. Slashes mark the phonemic form.
        if (value.includes('=') || !value.startsWith('/') || !value.endsWith('/')) {
          continue;
        }
        found.push({ ipa: value, accents });
      }
    }
  }

  return found;
}

/**
 * The upstream hyphenation, which gives the orthographic syllable count the
 * validate stage checks the syllable breakdown against.
 *
 * @param {string} english
 * @returns {string[]} syllables, or an empty array when upstream gives none
 */
function extractHyphenation(english) {
  const match = english.match(/\{\{(?:hyphenation|hyph)\|en\|([^}]*)\}\}/);
  if (!match) {
    return [];
  }
  return match[1]
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.includes('='));
}

/**
 * "Form-of" templates whose whole meaning IS the template, mapped to the prose
 * they stand for.
 *
 * These have to be rendered before the generic template strip below, because
 * that strip would otherwise leave an empty definition — which is exactly what
 * happens to `women` (`{{plural of|en|woman}}`) and `favorite`
 * (`{{stand sp|en|favourite|from=US}}`). Inflected and American-spelling forms
 * are words learners look up, so dropping them would be the wrong fix.
 *
 * @type {Array<{ pattern: RegExp, render: (target: string) => string }>}
 */
const FORM_OF_TEMPLATES = [
  { pattern: /\{\{plural of\|en\|([^|}]+)[^}]*\}\}/i, render: (t) => `Plural of ${t}.` },
  {
    pattern: /\{\{(?:standard spelling of|stand sp)\|en\|([^|}]+)[^}]*\}\}/i,
    render: (t) => `Standard American spelling of ${t}.`,
  },
  {
    pattern: /\{\{(?:alternative spelling of|alt sp)\|en\|([^|}]+)[^}]*\}\}/i,
    render: (t) => `Alternative spelling of ${t}.`,
  },
  {
    pattern: /\{\{(?:past participle of|past of|en-past of)\|en\|([^|}]+)[^}]*\}\}/i,
    render: (t) => `Past tense and past participle of ${t}.`,
  },
];

/**
 * Reduce one definition line of wikitext to plain prose.
 *
 * @param {string} line
 * @returns {string}
 */
function cleanDefinition(line) {
  for (const { pattern, render } of FORM_OF_TEMPLATES) {
    const match = line.match(pattern);
    if (match) {
      return render(match[1].trim());
    }
  }

  return (
    line
      // Templates that CARRY the prose a reader is meant to see: a link to
      // another term, a vernacular name, a non-gloss definition. Rendered to
      // their display text first, because the blanket strip below would
      // otherwise leave a hole mid-sentence — `{{vern|banana plant}}` in the
      // definition of `banana` is exactly that case.
      .replace(/\{\{(?:vern|w)\|([^|}]+)[^}]*\}\}/g, '$1')
      // `{{l|en|target}}` or `{{l|en|target|shown}}`. Split on `|` rather than
      // matching the optional group inline: the nested optional quantifier that
      // needed would backtrack badly on a long template body.
      .replace(/\{\{(?:l|link|m|ll)\|en\|([^{}]*)\}\}/g, (_match, rest) => {
        const parts = rest.split('|').filter((part) => !part.includes('='));
        return parts[1] || parts[0] || '';
      })
      .replace(/\{\{(?:n-g|non-gloss definition|non gloss definition)\|([^|}]+)[^}]*\}\}/g, '$1')
      // Drop the rest. Most are metadata (`{{senseid}}`, `{{defdate}}`,
      // `{{lb}}`, `{{q}}`), and a wrong guess would put markup on a word page.
      // Applied twice so a template nested one level deep also goes.
      .replace(/\{\{[^{}]*\}\}/g, ' ')
      .replace(/\{\{[^{}]*\}\}/g, ' ')
      // `[[target|shown]]` keeps what a reader sees; `[[target]]` the target.
      .replace(/\[\[[^\][|]*\|([^\][]*)\]\]/g, '$1')
      .replace(/\[\[([^\][]*)\]\]/g, '$1')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/'{2,}/g, '')
      // Collapse the whitespace a stripped template leaves behind, including
      // before punctuation, so the meaning reads as prose.
      .replace(/\s+([,;:.)])/g, '$1')
      .replace(/\(\s+/g, '(')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[,;:.\s]+/, '')
      .trim()
  );
}

/**
 * The first real definition in the English entry.
 *
 * Lines beginning `#*` (quotations) and `#:` (usage examples) are skipped:
 * Handoff §8.4 excludes both from the seed, and they are also where externally
 * sourced material with separate terms tends to appear.
 *
 * @param {string} english
 * @returns {string | null}
 */
function extractDefinition(english) {
  for (const line of english.split('\n')) {
    if (!line.startsWith('#') || line.startsWith('#*') || line.startsWith('#:')) {
      continue;
    }
    const cleaned = cleanDefinition(line.slice(1));
    // A one-word residue is usually a stripped template, not a definition.
    if (cleaned.length > 3 && /\s/.test(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Turn one page's wikitext into an artifact entry.
 *
 * Separated from the transport so the SAME extraction serves both the
 * single-page fetch and the batched one. At 6 500 headwords a request per word
 * is neither fast enough nor polite enough, but the parsing must not fork —
 * two extractors would drift and the artifact would depend on which path
 * produced it.
 *
 * @param {string} headword
 * @param {string} variant
 * @param {{wikitext: string, revisionId: number} | null} entry
 * @returns {object} one raw artifact entry, possibly carrying `error`
 */
function buildEntry(headword, variant, entry) {
  if (!entry) {
    return { headword, variant, error: 'no Wiktionary page' };
  }

  const english = englishSection(entry.wikitext);
  if (!english) {
    return { headword, variant, error: 'no English section' };
  }

  const sections = pronunciationSections(english);
  const transcriptions = sections.flatMap((section, index) =>
    extractTranscriptions(section).map((item) => ({ ...item, section: index })),
  );

  return {
    headword,
    variant,
    // Provenance, required for CC BY-SA attribution and recorded per word
    // (FR-CONTENT-01/05, NFR-LEGAL-05, Handoff §8.4).
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(headword)}#English`,
    sourceLicence: SOURCE_LICENCE,
    retrievedAt: new Date().toISOString().slice(0, 10),
    revisionId: entry.revisionId,
    definition: extractDefinition(english),
    hyphenation: extractHyphenation(english),
    // Raw upstream notation, preserved in the artifact rather than as a runtime
    // column (SDD §4.12, and the explicit exclusion of
    // `word_pronunciations.source_ipa`).
    transcriptions,
  };
}

/**
 * Write the raw entry artifact.
 *
 * @param {string} outPath
 * @param {string} variant
 * @param {object[]} entries
 * @returns {Promise<void>}
 */
async function writeEntries(outPath, variant, entries) {
  await fs.writeFile(
    outPath,
    `${JSON.stringify(
      {
        variant,
        source: 'English Wiktionary',
        sourceLicence: SOURCE_LICENCE,
        fetchedAt: new Date().toISOString(),
        entries,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  process.stdout.write(`\nWrote ${entries.length} raw entries to ${outPath}\n`);
}

/**
 * Fetch the frequency lists and reduce them to `headword -> rank`.
 *
 * Only the seeded headwords are kept. The artifact is content a maintainer
 * reviews in a diff, so it stays as small as the requirement allows; a headword
 * absent from every list is left out here and takes the documented unranked
 * position at load time instead.
 *
 * @param {string[]} headwords the seeded headwords
 * @returns {Promise<Map<string, number>>} headword to rank, most common lowest
 */
function frequencyRanksFor(headwords, ranked) {
  const wanted = new Set(headwords.map((headword) => headword.toLowerCase()));
  const ranks = new Map();

  for (const entry of ranked) {
    const word = entry.word.toLowerCase();
    // A word can appear more than once across the source tables; the most
    // common occurrence wins.
    if (wanted.has(word) && (!ranks.has(word) || entry.rank < ranks.get(word))) {
      ranks.set(word, entry.rank);
    }
  }

  return ranks;
}

async function main() {
  const args = process.argv.slice(2);
  const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'en-us';
  const outPath = args.includes('--out')
    ? path.resolve(args[args.indexOf('--out') + 1])
    : path.join(repoRoot, 'data', 'seed', `${variant}.raw.json`);

  // How many headwords to request. FR-WORD-10 wants at least 5 000 LOADED, and
  // a survey of the ranked source put the yield of usable American
  // transcriptions at about 82 %, so the default asks for enough to clear that
  // bar with room for the D4 tokenisation losses on top.
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 8000;

  const headwordsPath = path.join(repoRoot, 'data', 'seed', `${variant}.headwords.json`);
  const rankedSource = JSON.parse(await fs.readFile(headwordsPath, 'utf8')).ranked;
  const headwords = selectHeadwords({ variant, ranked: rankedSource, limit });
  if (headwords.length === 0) {
    throw new Error(`No headwords selected for variant "${variant}".`);
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  // Refreshing the frequency ranks alone leaves the entry artifact untouched.
  // Re-fetching every entry to obtain a rank would rewrite `fetchedAt` and pull
  // in whatever changed upstream since, turning a narrow content change into an
  // unreviewable diff.
  if (!args.includes('--frequency-only')) {
    process.stdout.write(
      `Fetching ${headwords.length} headwords for ${variant} in batches of ${BATCH_SIZE}\n`,
    );

    const entries = [];
    let unusable = 0;
    for (let index = 0; index < headwords.length; index += BATCH_SIZE) {
      const batch = headwords.slice(index, index + BATCH_SIZE);
      const pages = await fetchBatch(batch);

      for (const headword of batch) {
        const entry = buildEntry(headword, variant, pages.get(headword) ?? null);
        entries.push(entry);
        if (entry.error) {
          unusable += 1;
        }
      }

      const done = Math.min(index + BATCH_SIZE, headwords.length);
      process.stdout.write(`  . ${done}/${headwords.length}  (${unusable} unusable so far)\n`);
      await sleep(REQUEST_INTERVAL_MS);
    }

    await writeEntries(outPath, variant, entries);
  }

  // The frequency artifact (FR-WORD-04), written alongside the raw entries so
  // one documented command produces everything the seed needs.
  const ranks = frequencyRanksFor(headwords, rankedSource);
  const frequencyPath = path.join(path.dirname(outPath), `${variant}.frequency.json`);

  await fs.writeFile(
    frequencyPath,
    `${JSON.stringify(
      {
        variant,
        source: 'English Wiktionary — TV/movie frequency lists (2006)',
        // Derived from the committed ranked headword artifact rather than
        // re-fetched: the ranks are already there, and one network round trip
        // for data sitting in the repository is waste.
        derivedFrom: `data/seed/${variant}.headwords.json`,
        sourceLicence: SOURCE_LICENCE,
        fetchedAt: new Date().toISOString(),
        // Sorted by rank, so the committed artifact reads as a frequency list
        // and a diff shows a real ordering change rather than key churn.
        ranks: Object.fromEntries([...ranks].sort((a, b) => a[1] - b[1])),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  process.stdout.write(
    `Wrote ${ranks.size} of ${headwords.length} headword ranks to ${frequencyPath}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
