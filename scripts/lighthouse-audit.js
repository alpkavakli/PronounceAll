/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Lighthouse audit (NFR-PERF-03, NFR-PERF-01; Charter SC4): every page of
 * the NFR-PERF-01 list, Lighthouse's default mobile profile, all four
 * categories at 90 or above, LCP within 2.5 s and CLS within 0.1.
 *
 * The 404 word page is on the NFR-PERF-01 list but cannot be scored:
 * Lighthouse refuses any document served with an error status
 * (ERRORED_DOCUMENT_REQUEST), and FR-WORD-04 requires that page to be a
 * genuine 404. Its accessibility is covered by tests/e2e/a11y-wcag22.spec.js.
 *
 * Runs against a running server: AUDIT_BASE_URL (default
 * http://127.0.0.1:3000). Uses CHROME_PATH, or Playwright's Chromium. Writes
 * lighthouse-report/summary.json and exits 1 on any miss.
 *
 * Usage: npm run audit:lighthouse
 */

import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const BASE = (process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const PAGES = ['/', '/en-us/cupcake', '/en-us/learnIPA', '/learnIPA', '/register', '/login', '/settings', '/privacy', '/kvkk', '/practice'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const MIN_SCORE = 90;
const MAX_LCP_MS = 2500;
const MAX_CLS = 0.1;

async function main() {
  const chrome = await launch({
    chromePath: process.env.CHROME_PATH || chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox'],
  });
  const rows = [];
  try {
    for (const path of PAGES) {
      const { lhr } = await lighthouse(`${BASE}${path}`, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES });
      if (lhr.runtimeError) throw new Error(`${path}: ${lhr.runtimeError.code}`);
      const scores = Object.fromEntries(CATEGORIES.map((id) => [id, Math.round(lhr.categories[id].score * 100)]));
      const lcp = lhr.audits['largest-contentful-paint'].numericValue;
      const cls = lhr.audits['cumulative-layout-shift'].numericValue;
      const misses = [
        ...CATEGORIES.filter((id) => scores[id] < MIN_SCORE).map((id) => `${id} ${scores[id]}`),
        ...(lcp > MAX_LCP_MS ? [`LCP ${Math.round(lcp)} ms`] : []),
        ...(cls > MAX_CLS ? [`CLS ${cls.toFixed(3)}`] : []),
      ];
      rows.push({ path, ...scores, lcpMs: Math.round(lcp), cls: Number(cls.toFixed(3)), misses });
      process.stdout.write(
        `${path.padEnd(18)} perf ${scores.performance} a11y ${scores.accessibility} bp ${scores['best-practices']} seo ${scores.seo}` +
          ` | LCP ${(lcp / 1000).toFixed(1)} s CLS ${cls.toFixed(3)}${misses.length ? `  MISS: ${misses.join(', ')}` : ''}\n`,
      );
    }
  } finally {
    await chrome.kill();
  }
  await mkdir('lighthouse-report', { recursive: true });
  await writeFile('lighthouse-report/summary.json', `${JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2)}\n`);
  const failed = rows.filter((row) => row.misses.length);
  if (failed.length) {
    process.stderr.write(`${failed.length} page(s) below the NFR-PERF-01/03 bar.\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
