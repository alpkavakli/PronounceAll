/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Validate computed syllable boundaries against an independent reference
 * (FR-WORD-03, D4 §3.8).
 *
 * `syllabify-pronunciations.js` would write 2 187 learner-facing divisions.
 * Before that happens they are checked against CMUdict plus Kyle Gorman's
 * `syllabify`, which parses ARPABET using English phonology rather than the
 * hand-built onset table our own pass carries.
 *
 * The reference is a SECOND OPINION, not an authority, and the difference
 * matters: `syllabify` implements phonological maximal onset, so it divides
 * `letter` as `L EH1 . T ER0` and `orange` as `AO1 . R AH0 N JH`. Pronunciation
 * dictionaries divide both the other way, which is exactly what our
 * checked-vowel and rhotic-coda rules reproduce. A disagreement is therefore
 * not automatically our error, so every one is CLASSIFIED by the rule that
 * produced it rather than counted as a failure.
 *
 * Nothing is written. This script only reports.
 *
 * Usage:
 *   node scripts/validate-syllabification.js
 *   node scripts/validate-syllabification.js --limit 8
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { closePool } from '../src/lib/mysql.js';
import { listOccurrencesForVariant } from '../src/repositories/phonemes.repository.js';
import { listAllPronunciations, listWordsForVariant } from '../src/repositories/words.repository.js';
import { resolveActiveVariant } from '../src/services/catalogue.service.js';
import {
  NUCLEUS_CATEGORIES,
  insertSyllableMarks,
  syllabify,
} from '../src/services/syllabification.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(here, '..', 'tools', 'validation');

const out = (line) => process.stdout.write(`${line}\n`);

/**
 * Canonical unit to ARPABET.
 *
 * The mapping is many-to-one in two places, which is correct rather than lossy:
 * CMUdict separates `/ə/` from `/ʌ/` and `/ɚ/` from `/ɝ/` by stress digit and
 * not by symbol, so each pair shares a base phone. Alignment compares base
 * phones only, so the distinction is not needed here.
 */
const TO_ARPABET = new Map(
  Object.entries({
    p: 'P', b: 'B', t: 'T', d: 'D', k: 'K', ɡ: 'G', tʃ: 'CH', dʒ: 'JH',
    f: 'F', v: 'V', θ: 'TH', ð: 'DH', s: 'S', z: 'Z', ʃ: 'SH', ʒ: 'ZH',
    h: 'HH', m: 'M', n: 'N', ŋ: 'NG', l: 'L', ɹ: 'R', w: 'W', j: 'Y',
    i: 'IY', ɪ: 'IH', ɛ: 'EH', æ: 'AE', ʌ: 'AH', ə: 'AH', ɑ: 'AA', ɔ: 'AO',
    ʊ: 'UH', u: 'UW', ɝ: 'ER', ɚ: 'ER',
    eɪ: 'EY', aɪ: 'AY', ɔɪ: 'OY', aʊ: 'AW', oʊ: 'OW',
  }),
);

const CHECKED = new Set(['ɪ', 'ɛ', 'æ', 'ʌ', 'ʊ']);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

/**
 * CMUdict as headword -> list of variants.
 *
 * Each variant keeps BOTH forms. `phones` retains the stress digits, because
 * `syllabify` is stress-aware — its lax-vowel set is spelled `IH1`, `EH1`,
 * `AE1`, so stripping the digit silently disables the rule that keeps an `/s/`
 * in the coda of a stressed lax syllable. `base` exists only to match a variant
 * against our canonical unit sequence, which carries no stress digits.
 */
async function loadCmudict() {
  const text = await fs.readFile(path.join(toolsDir, 'cmudict.dict'), 'utf8');
  const dict = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(';;;')) continue;
    const [head, ...rest] = line.split(' ');
    if (rest.length === 0) continue;
    const word = head.replace(/\(\d+\)$/, '');
    const phones = [];
    for (const token of rest) {
      if (token.startsWith('#')) break;
      const phone = token.trim();
      if (phone) phones.push(phone);
    }
    if (phones.length === 0) continue;
    if (!dict.has(word)) dict.set(word, []);
    dict.get(word).push({
      phones,
      base: phones.map((phone) => phone.replace(/\d$/, '')),
      stress: phones.filter((phone) => /\d$/.test(phone)).map((phone) => Number(phone.slice(-1))),
    });
  }
  return dict;
}

/**
 * The stress our own transcription assigns to each nucleus, in order.
 *
 * A mark applies to the syllable it opens, so it belongs to the next nucleus:
 * `ˈ` is primary (1), `ˌ` secondary (2), an unmarked nucleus 0. This is what
 * distinguishes two CMUdict variants that share a base sequence — `ˈɹɛkɚd` from
 * `ɹɪˈkɔɹd` — so the reference is asked about the pronunciation we actually
 * hold rather than whichever variant happened to be listed first.
 */
function ourStressProfile(transcription, units) {
  const profile = [];
  let cursor = 0;
  let next = 0;
  let pending = 0;

  while (cursor < transcription.length) {
    const unit = units[next];
    if (unit && transcription.startsWith(unit.ipaSymbol, cursor)) {
      if (NUCLEUS_CATEGORIES.has(unit.category)) {
        profile.push(pending);
        pending = 0;
      }
      cursor += unit.ipaSymbol.length;
      next += 1;
      continue;
    }
    if (transcription[cursor] === 'ˈ') pending = 1;
    else if (transcription[cursor] === 'ˌ') pending = 2;
    else return null;
    cursor += 1;
  }

  return next === units.length ? profile : null;
}

/** Run the reference syllabifier over every alignable row in one process. */
function referenceBoundaries(items) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [path.join(toolsDir, 'boundaries.py')], {
      cwd: toolsDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`boundaries.py exited ${code}: ${stderr}`));
        return;
      }
      const parsed = new Map();
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        parsed.set(row.id, row.starts ?? null);
      }
      resolve(parsed);
    });
    for (const item of items) child.stdin.write(`${JSON.stringify(item)}\n`);
    child.stdin.end();
  });
}

/**
 * Which of our rules accounts for a boundary the reference places elsewhere?
 *
 * The two syllabifications are compared position by position rather than as
 * sets. A differing boundary is ONE disagreement, not two: counting our
 * boundary and the reference's complementary one separately would label every
 * checked-vowel case `checked-vowel+other` and bury the cases that have no
 * explanation — which are the only ones worth reviewing.
 *
 * A cause is read from our side, because the question being asked is what OUR
 * pass did that maximal onset alone would not.
 */
function classify(units, ourStarts, referenceStarts) {
  const reasons = new Set();
  const pairs = Math.min(ourStarts.length, referenceStarts.length);

  if (ourStarts.length !== referenceStarts.length) reasons.add('syllable-count');

  for (let i = 0; i < pairs; i += 1) {
    const ours = ourStarts[i];
    const theirs = referenceStarts[i];
    if (ours === theirs) continue;

    if (ours > theirs) {
      // A LATER start means the previous syllable keeps consonants the
      // reference hands to the next onset — our checked-vowel and rhotic-coda
      // rules, which is the whole point of them.
      const nucleus = units
        .slice(0, theirs)
        .reverse()
        .find((unit) => unit.category !== 'consonant');
      const kept = units.slice(theirs, ours).map((unit) => unit.ipaSymbol);
      if (kept.includes('ɹ')) reasons.add('rhotic-coda');
      else if (nucleus && CHECKED.has(nucleus.ipaSymbol)) reasons.add('checked-vowel');
      else reasons.add('other');
    } else {
      // An EARLIER start means our onset claimed more than the reference
      // allows. Only our onset table can do that, so these are ours to
      // justify — `beɪ.smənt` for `basement` is in here.
      reasons.add('onset-too-greedy');
    }
  }

  return [...reasons].sort();
}

async function main() {
  const limit = Number(argValue('--limit') ?? 6);
  const variant = await resolveActiveVariant('en-us');

  const artifact = JSON.parse(
    await fs.readFile(path.join(here, '..', 'data', 'seed', `${variant.code}.phonemes.json`), 'utf8'),
  );
  const categories = new Map(artifact.units.map((unit) => [unit.ipaSymbol, unit.category]));

  const [pronunciations, occurrences, words, cmudict] = await Promise.all([
    listAllPronunciations(variant.variantId),
    listOccurrencesForVariant(variant.variantId),
    listWordsForVariant(variant.variantId),
    loadCmudict(),
  ]);

  const headwordByWordId = new Map(
    words.map((word) => [word.wordId, word.normalizedHeadword ?? word.displayHeadword]),
  );

  const unitsByPronunciation = new Map();
  for (const occurrence of occurrences) {
    if (!unitsByPronunciation.has(occurrence.pronunciationId)) {
      unitsByPronunciation.set(occurrence.pronunciationId, []);
    }
    unitsByPronunciation.get(occurrence.pronunciationId).push({
      ipaSymbol: occurrence.ipaSymbol,
      category: categories.get(occurrence.ipaSymbol) ?? 'consonant',
    });
  }

  const candidates = [];
  for (const pronunciation of pronunciations) {
    if (pronunciation.ipaTranscription.includes('.')) continue;
    const units = unitsByPronunciation.get(pronunciation.pronunciationId);
    if (!units || units.length === 0) continue;
    if (insertSyllableMarks(pronunciation.ipaTranscription, units) === null) continue;
    candidates.push({ ...pronunciation, units, headword: headwordByWordId.get(pronunciation.wordId) });
  }

  const alignable = [];
  const unalignable = [];
  const ambiguous = [];
  for (const candidate of candidates) {
    const arpabet = candidate.units.map((unit) => TO_ARPABET.get(unit.ipaSymbol));
    const entries = cmudict.get(String(candidate.headword || '').toLowerCase()) || [];
    if (arpabet.includes(undefined)) {
      unalignable.push(candidate);
      continue;
    }

    // 1. Every variant whose BASE phones are our unit sequence.
    const sameBase = entries.filter(
      (entry) =>
        entry.base.length === arpabet.length && entry.base.every((phone, index) => phone === arpabet[index]),
    );
    if (sameBase.length === 0) {
      unalignable.push(candidate);
      continue;
    }

    // 2. One candidate needs no disambiguation.
    let chosen = sameBase.length === 1 ? sameBase[0] : null;

    // 3. Several variants share the base sequence and differ only in stress, so
    //    our own marks decide which pronunciation we are actually holding.
    if (!chosen) {
      const profile = ourStressProfile(candidate.ipaTranscription, candidate.units);
      const matches = profile
        ? sameBase.filter(
            (entry) =>
              entry.stress.length === profile.length &&
              entry.stress.every((value, index) => value === profile[index]),
          )
        : [];
      // 4. Still more than one, or none: choosing arbitrarily would compare
      //    against a pronunciation we do not hold, so the row is not validated.
      if (matches.length === 1) [chosen] = matches;
    }

    if (!chosen) {
      ambiguous.push(candidate);
      continue;
    }

    // 5. The reference receives the ORIGINAL stress-bearing phones.
    alignable.push({ ...candidate, phones: chosen.phones });
  }

  const reference = await referenceBoundaries(
    alignable.map((row) => ({ id: row.pronunciationId, phones: row.phones })),
  );

  const agree = [];
  const disagree = [];
  const failed = [];
  for (const row of alignable) {
    const theirs = reference.get(row.pronunciationId);
    if (!theirs) {
      failed.push(row);
      continue;
    }
    const ours = syllabify(row.units);
    const same = ours.length === theirs.length && ours.every((value, index) => value === theirs[index]);
    if (same) agree.push(row);
    else disagree.push({ ...row, ours, theirs, reasons: classify(row.units, ours, theirs) });
  }

  const byReason = new Map();
  for (const row of disagree) {
    const key = row.reasons.join('+');
    if (!byReason.has(key)) byReason.set(key, []);
    byReason.get(key).push(row);
  }

  out('Syllable-boundary validation — CMUdict + Kyle Gorman syllabify\n');
  out(`  candidate rows            ${candidates.length}`);
  out(`  alignable to CMUdict      ${alignable.length}`);
  out(`  unalignable               ${unalignable.length}   (absent from CMUdict, or a different pronunciation)`);
  out(`  ambiguous variant         ${ambiguous.length}   (stress could not pick one CMUdict variant; not validated)`);
  out(`  reference errored         ${failed.length}`);
  out(`  exact boundary agreement  ${agree.length}`);
  out(`  disagreement              ${disagree.length}\n`);

  if (alignable.length > 0) {
    out(`  agreement on alignable rows: ${((agree.length / alignable.length) * 100).toFixed(1)}%\n`);
  }

  const marked = (units, starts) =>
    units.map((unit, index) => (starts.includes(index) && index > 0 ? `.${unit.ipaSymbol}` : unit.ipaSymbol)).join('');

  for (const [reason, rows] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out(`  ${reason}: ${rows.length}`);
    for (const row of rows.slice(0, limit)) {
      out(
        `    ${String(row.headword).padEnd(14)} ours ${marked(row.units, row.ours).padEnd(18)} reference ${marked(row.units, row.theirs)}`,
      );
    }
    out('');
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
