/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The PronounceAll Phonetic web font (FR-IPA-09, NFR-PERF-03; Frontend
 * Baseline §4.2; maintainer decision 2026-10-01): the subset holds every
 * character PronounceAll renders in IPA, the committed character set is
 * current, and the modified font uses no Reserved Font Name.
 *
 * Coverage is checked against the content itself — the stored corpus, the D4
 * artifact and the template characters — so seeding a word with a new symbol
 * fails here until the character set and the font are regenerated
 * (npm run fonts:charset, then npm run fonts:build).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, test } from '@jest/globals';
import * as fontkit from 'fontkit';

const { closePool } = await import('../../src/lib/mysql.js');
const { CHARSET_FILE, collectPhoneticCharacters, formatCharset } = await import('../../scripts/generate-phonetic-charset.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONT = path.join(ROOT, 'src', 'public', 'fonts', 'pronounceall-phonetic-400.woff2');
const UPSTREAM = path.join(ROOT, 'assets', 'fonts-source', 'charis-sil-400.woff2');
const RESERVED = /charis|\bsil\b/i;
/** Copyright, designers, licence, licence URL: preserved from upstream. */
const PRESERVED = new Set([0, 9, 13, 14]);

const font = fontkit.create(await readFile(FONT));
const upstream = fontkit.create(await readFile(UPSTREAM));
const nameRecords = (face) => face.name.records;
const englishName = (face, key) => {
  const value = nameRecords(face)[key];
  return typeof value === 'string' ? value : value?.en ?? Object.values(value ?? {})[0];
};

afterAll(async () => {
  await closePool();
});

describe('coverage', () => {
  test('every character rendered in IPA is in the font: corpus, D4 and templates', async () => {
    const sources = await collectPhoneticCharacters();
    const missing = [...sources.entries()]
      .filter(([character]) => !font.hasGlyphForCodePoint(character.codePointAt(0)))
      .map(([character, from]) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${character} (${[...from].join(', ')})`);
    expect(missing).toEqual([]);
  });

  test('the committed character set is current', async () => {
    const committed = await readFile(CHARSET_FILE, 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(formatCharset(await collectPhoneticCharacters()));
  });

  test('the D4 inventory is fully present — all 41 teaching units', async () => {
    const d4 = JSON.parse(await readFile(path.join(ROOT, 'data', 'seed', 'en-us.phonemes.json'), 'utf8'));
    expect(d4.units).toHaveLength(41);
    for (const unit of d4.units) {
      for (const character of unit.ipaSymbol) expect([unit.ipaSymbol, font.hasGlyphForCodePoint(character.codePointAt(0))]).toEqual([unit.ipaSymbol, true]);
    }
  });

  test('stress marks and the syllable separator are present', () => {
    for (const character of ['ˈ', 'ˌ', '.', '/']) expect([character, font.hasGlyphForCodePoint(character.codePointAt(0))]).toEqual([character, true]);
  });
});

describe('licence (SIL OFL 1.1, Reserved Font Names)', () => {
  test('the upstream declares the Reserved Font Names this build was reviewed against', () => {
    expect(englishName(upstream, 'license')).toMatch(/Reserved Font Names "Charis" and "SIL"/);
  });

  test('the modified font is renamed throughout: family, full, PostScript and unique names', () => {
    expect(font.familyName).toBe('PronounceAll Phonetic');
    expect(font.fullName).toBe('PronounceAll Phonetic Regular');
    expect(font.postscriptName).toBe('PronounceAllPhonetic-Regular');
    expect(englishName(font, 'uniqueSubfamily')).toMatch(/^PronounceAllPhonetic-Regular;/);
  });

  test('no name record uses a Reserved Font Name, apart from the preserved notices', () => {
    const ids = { copyright: 0, designer: 9, license: 13, licenseURL: 14 };
    const offending = Object.entries(nameRecords(font))
      .filter(([key]) => !PRESERVED.has(ids[key]))
      .filter(([, value]) => RESERVED.test(typeof value === 'string' ? value : JSON.stringify(value)))
      .map(([key]) => key);
    expect(offending).toEqual([]);
  });

  test('the copyright notice and the licence are preserved from upstream', () => {
    expect(englishName(font, 'copyright')).toBe(englishName(upstream, 'copyright'));
    expect(englishName(font, 'license')).toBe(englishName(upstream, 'license'));
    expect(englishName(font, 'licenseURL')).toBe(englishName(upstream, 'licenseURL'));
  });

  test('the font log and the licence text ship beside the font', async () => {
    const fontlog = await readFile(path.join(ROOT, 'src', 'public', 'fonts', 'FONTLOG-PronounceAllPhonetic.txt'), 'utf8');
    expect(fontlog).toMatch(/Modified Version/);
    expect(fontlog).toMatch(/not endorsed/);
    expect(await readFile(path.join(ROOT, 'src', 'public', 'fonts', 'OFL-CharisSIL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
  });
});
