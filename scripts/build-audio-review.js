/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Build the maintainer's audio review page (audio source policy v1.1;
 * FR-CONTENT-04/05).
 *
 * Every proposed replacement is listenable from one page, beside the clip it
 * would replace, with its source, author and licence shown. Nothing is promoted
 * here: the page is a review surface, and `promote-audio-candidates.js` acts
 * only on what the maintainer names afterwards.
 *
 * The page is written OUTSIDE the audio store. `data/audio` is served with
 * year-long immutable cache headers and is what a deployment copies, so a
 * review artefact does not belong in it. The page instead loads the clips over
 * HTTP from the dev server, which means it can simply be opened from disk while
 * `npm run dev` is running.
 *
 * Usage:
 *   npm run dev                 # in another terminal
 *   node scripts/build-audio-review.js
 *   # then open data/audio-review/index.html
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { closePool, getPool } from '../src/lib/mysql.js';

const out = (line) => process.stdout.write(`${line}\n`);

const OUTPUT_DIR = path.join('data', 'audio-review');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** @param {string} sql @param {unknown[]} [params] */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/** Minimal HTML escaping for text taken from an upstream source. */
function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function player(baseUrl, storageKey) {
  return storageKey
    ? `<audio controls preload="none" src="${escape(baseUrl)}/audio/${escape(storageKey)}"></audio>`
    : '<span class="none">no asset</span>';
}

async function main() {
  const variantCode = argValue('--variant') ?? 'en-us';
  const baseUrl = (argValue('--base-url') ?? 'http://localhost:3000').replace(/\/+$/, '');

  // What each phoneme currently serves, and what is waiting to replace it.
  const current = await query(
    `SELECT p.ipa_symbol AS symbol, p.frequency_rank AS rnk,
            a.storage_key AS storageKey, a.source_kind AS sourceKind,
            a.author AS author, a.licence_identifier AS licence
       FROM phonemes p
       JOIN language_variants v ON v.variant_id = p.variant_id
       LEFT JOIN audio_assets a ON a.audio_asset_id = p.audio_asset_id
      WHERE v.code = ?
      ORDER BY p.frequency_rank`,
    [variantCode],
  );

  const proposals = await query(
    `SELECT a.asset_key AS assetKey, a.storage_key AS storageKey, a.source_kind AS sourceKind,
            a.author AS author, a.licence_identifier AS licence, a.licence_url AS licenceUrl,
            a.source_reference AS sourceReference, a.attribution_text AS attribution,
            a.byte_length AS byteLength
       FROM audio_assets a
       JOIN language_variants v ON v.variant_id = a.variant_id
      WHERE v.code = ? AND a.generation_status = 'ready'
        AND a.asset_key LIKE 'phoneme:%'
        AND (a.source_kind = 'commons_human' OR a.asset_key LIKE '%#%')
      ORDER BY a.asset_key`,
    [variantCode],
  );

  // asset_key shape is `phoneme:<variant>:<target>:<source>[...]`, and the
  // target carries the `#n` discriminator for a candidate.
  const commons = [];
  const candidates = new Map();

  for (const row of proposals) {
    const target = row.assetKey.split(':')[2];
    if (row.sourceKind === 'commons_human') {
      commons.push({ ...row, symbol: target });
      continue;
    }
    const [symbol, index] = target.split('#');
    if (!candidates.has(symbol)) {
      candidates.set(symbol, []);
    }
    candidates.get(symbol).push({ ...row, symbol, index: Number(index) });
  }

  for (const list of candidates.values()) {
    list.sort((a, b) => a.index - b.index);
  }

  const currentBySymbol = new Map(current.map((row) => [row.symbol, row]));

  const commonsRows = commons
    .map((row) => {
      const now = currentBySymbol.get(row.symbol);
      return `
      <tr>
        <td class="sym">${escape(row.symbol)}</td>
        <td>
          <div class="lbl">now — ${escape(now?.sourceKind ?? 'none')}</div>
          ${player(baseUrl, now?.storageKey)}
        </td>
        <td>
          <div class="lbl">proposed — Wikimedia Commons</div>
          ${player(baseUrl, row.storageKey)}
        </td>
        <td class="meta">
          <div><strong>${escape(row.author)}</strong></div>
          <div>${escape(row.licence)}</div>
          <div><a href="${escape(row.sourceReference)}" target="_blank" rel="noopener noreferrer">source page</a></div>
        </td>
      </tr>`;
    })
    .join('');

  const candidateSections = [...candidates.entries()]
    .map(([symbol, list]) => {
      const now = currentBySymbol.get(symbol);
      const items = list
        .map(
          (row) => `
        <div class="cand">
          <div class="lbl">#${row.index}</div>
          ${player(baseUrl, row.storageKey)}
          <div class="meta">${escape(row.byteLength)} bytes</div>
        </div>`,
        )
        .join('');
      return `
      <section>
        <h3>/${escape(symbol)}/ — Piper candidates</h3>
        <p class="note">No Commons isolated articulation exists for this unit, so these are fresh
        Piper draws. Pick one, or reject them all.</p>
        <div class="cand current">
          <div class="lbl">now (rejected)</div>
          ${player(baseUrl, now?.storageKey)}
        </div>
        <div class="cands">${items}</div>
      </section>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PronounceAll — audio review</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem; color: #16324f; background: #fbfbfd; }
  h1 { font-size: 1.4rem; }
  .warn { background: #fff4e5; border: 1px solid #f0c893; padding: .8rem 1rem; border-radius: .4rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border-bottom: 1px solid #e2e6ee; padding: .55rem .5rem; text-align: left; vertical-align: middle; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #5a6b82; }
  .sym { font-size: 1.5rem; font-family: "Charis SIL", "Doulos SIL", "Gentium Plus", serif; white-space: nowrap; }
  .lbl { font-size: .75rem; color: #5a6b82; margin-bottom: .2rem; }
  .meta { font-size: .8rem; color: #5a6b82; }
  .none { color: #a33; font-size: .85rem; }
  audio { height: 32px; max-width: 240px; }
  section { margin-top: 2rem; padding-top: 1rem; border-top: 2px solid #e2e6ee; }
  .cands { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: .6rem; }
  .cand { border: 1px solid #e2e6ee; border-radius: .4rem; padding: .6rem; background: #fff; }
  .cand.current { background: #fdf0f0; display: inline-block; }
  .note { font-size: .88rem; color: #5a6b82; max-width: 60ch; }
  code { background: #eef1f6; padding: .1rem .3rem; border-radius: .2rem; }
</style>
</head>
<body>
<h1>Audio review — ${escape(variantCode)}</h1>

<p class="warn"><strong>Nothing on this page is in production.</strong> Every phoneme still serves
the clip in the “now” column. Listen, then promote only what you approve:<br>
<code>npm run audio:promote -- t d k</code> for Commons replacements, and
<code>npm run audio:promote -- --piper w 3</code> to adopt a numbered candidate.</p>

<p class="note">Audio is loaded from <code>${escape(baseUrl)}</code>, so <code>npm run dev</code>
must be running. Generated ${escape(new Date().toISOString().slice(0, 16).replace('T', ' '))}.</p>

<h2>Commons replacements (${commons.length})</h2>
<table>
  <thead><tr><th>Unit</th><th>Current clip</th><th>Proposed clip</th><th>Author / licence</th></tr></thead>
  <tbody>${commonsRows}</tbody>
</table>

${candidateSections}

</body>
</html>
`;

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, 'index.html');
  await fs.writeFile(file, html, 'utf8');

  out(`Wrote ${file}`);
  out(`  ${commons.length} Commons replacement(s)`);
  for (const [symbol, list] of candidates) {
    out(`  ${list.length} Piper candidate(s) for /${symbol}/`);
  }
  out('');
  out('Start the app with `npm run dev`, then open that file in a browser.');
  out('NOTHING IS PROMOTED. Every phoneme still serves its current clip.');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
