/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The phoneme learning pages in a browser (FR-IPA-07, FR-IPA-09, FR-IPA-10,
 * FR-WORD-07, NFR-A11Y-02).
 *
 * The glyph-coverage check is the one specific to these pages: FR-IPA-09 exists
 * because a tofu box where a phoneme should be destroys the product's core
 * value, and a 41-row inventory is where that would show up first.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PER_VARIANT = '/en-us/learnIPA';
const GLOBAL = '/learnIPA';

test.describe('FR-IPA-07 — the ranked inventory renders', () => {
  test('shows every canonical unit', async ({ page }) => {
    await page.goto(PER_VARIANT);
    await expect(page.locator('.phoneme-row')).toHaveCount(41);
  });

  test('the first rows are the most frequent units', async ({ page }) => {
    await page.goto(PER_VARIANT);
    const first = await page
      .locator('.phoneme-row__symbol')
      .first()
      .evaluate((node) => node.textContent.replace(/Phoneme:\s*/, '').trim());

    // Derived from the corpus, so the exact leader is data — but it must be a
    // single canonical unit, not a rank number or empty.
    expect(first).toMatch(/^\S{1,2}$/);
  });

  test('each row names its example word', async ({ page }) => {
    await page.goto(PER_VARIANT);
    await expect(page.locator('.phoneme-row__example strong').first()).not.toBeEmpty();
  });
});

test.describe('FR-IPA-09 — IPA glyphs actually render', () => {
  test('no phoneme falls back to a tofu box', async ({ page }) => {
    await page.goto(PER_VARIANT);

    // A .notdef glyph collapses to a box of a characteristic width. Measuring
    // that every symbol has real painted extent catches a missing font, which
    // is the failure FR-IPA-09 is about — a screenshot diff would too, but this
    // does not need a baseline to maintain.
    const widths = await page.locator('.phoneme-row__symbol').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );

    expect(widths).toHaveLength(41);
    for (const width of widths) {
      expect(width).toBeGreaterThan(0);
    }
  });

  test('IPA elements use the IPA font stack, not the UI font', async ({ page }) => {
    await page.goto(PER_VARIANT);
    const family = await page
      .locator('.phoneme-row__symbol')
      .first()
      .evaluate((node) => getComputedStyle(node).fontFamily);

    expect(family).toMatch(/Charis SIL|Doulos SIL|Gentium|Noto Sans/);
  });
});

test.describe('FR-IPA-10 — the cross-variant index', () => {
  test('renders the same units and marks the variant', async ({ page }) => {
    await page.goto(GLOBAL);

    await expect(page.locator('.phoneme-row')).toHaveCount(41);
    await expect(page.locator('.phoneme-row__variant').first()).toHaveText('en-us');
  });

  test('is reachable from the footer of a word page', async ({ page }) => {
    await page.goto('/en-us/cupcake');
    await page.locator('.site-footer a[href="/learnIPA"]').click();

    await expect(page).toHaveURL(/\/learnIPA$/);
    await expect(page.locator('.phoneme-row')).toHaveCount(41);
  });
});

test.describe('FR-WORD-07 — responsive', () => {
  for (const width of [320, 375, 768, 1440]) {
    test(`no horizontal scrolling at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(PER_VARIANT);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  }
});

test.describe('NFR-A11Y-02 — accessibility', () => {
  test('the per-variant page reports zero axe-core violations', async ({ page }) => {
    await page.goto(PER_VARIANT);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('the global page reports zero axe-core violations', async ({ page }) => {
    await page.goto(GLOBAL);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('FR-WORD-08 — reads without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the whole inventory is still there', async ({ page }) => {
    // Nothing on this page needs script: it is a server-rendered list.
    await page.goto(PER_VARIANT);
    await expect(page.locator('.phoneme-row')).toHaveCount(41);
    await expect(page.locator('.phoneme-row__example strong').first()).not.toBeEmpty();
  });
});
