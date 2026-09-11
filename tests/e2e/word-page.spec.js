/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The word page in a real browser (FR-WORD-03/04/07/08, NFR-A11Y-02/08).
 *
 * These cover what only a browser can prove: that the page reads correctly with
 * JavaScript switched off, that it never scrolls sideways at the widths
 * FR-WORD-07 names, that touch targets meet the 44 px floor, and that axe-core
 * reports nothing.
 *
 * The suite runs against the seeded dictionary, so `npm run seed` must have run
 * against the database under test.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WORD_URL = '/en-us/cupcake';

/** The widths FR-WORD-07 names, from the 320 px floor to a wide desktop. */
const VIEWPORTS = [
  { width: 320, height: 640, label: '320 (smallest supported)' },
  { width: 375, height: 812, label: '375 (phone)' },
  { width: 768, height: 1024, label: '768 (tablet)' },
  { width: 1024, height: 768, label: '1024 (small laptop)' },
  { width: 1440, height: 900, label: '1440 (desktop)' },
];

test.describe('FR-WORD-03 — content', () => {
  test('renders the word, meaning, IPA, and syllable breakdown', async ({ page }) => {
    await page.goto(WORD_URL);

    await expect(page.getByRole('heading', { level: 1, name: 'cupcake' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pronunciation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meaning' })).toBeVisible();
    await expect(page.locator('.ipa').first()).toBeVisible();
    await expect(page.locator('.syllables').first()).toContainText('·');
  });

  test('shows the upstream attribution and licence (FR-CONTENT-05)', async ({ page }) => {
    await page.goto(WORD_URL);

    const attribution = page.locator('.attribution');
    await expect(attribution).toContainText('CC BY-SA 4.0');
    await expect(attribution.getByRole('link')).toHaveAttribute(
      'href',
      /en\.wiktionary\.org/,
    );
  });

  test('renders no audio control that cannot play', async ({ page }) => {
    await page.goto(WORD_URL);

    // A control that cannot work is worse than leaving it out. This began as
    // "no audio element at all", which held only while every asset was still
    // pending; the durable rule is that any control on the page has a real
    // source behind it.
    const sources = await page.locator('audio').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')));
    for (const source of sources) {
      expect(source).toMatch(/^\/audio\/[0-9a-f]{2}\/[0-9a-f]{64}\./);
    }

    // Iteration 2 made the phonemes clickable (FR-IPA-02), superseding this
    // test's original assertion that no `data-phoneme-id` existed. The
    // interaction itself belongs to `phoneme-interaction.spec.js`; asserting
    // presence here keeps the two iterations' expectations from silently
    // contradicting each other again.
    await expect(page.locator('[data-phoneme-id]').first()).toBeVisible();
  });
});

test.describe('FR-WORD-08 — reading without JavaScript', () => {
  test('the word page reads correctly with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(WORD_URL);

    await expect(page.getByRole('heading', { level: 1, name: 'cupcake' })).toBeVisible();
    await expect(page.locator('.ipa').first()).toBeVisible();
    await expect(page.locator('.syllables').first()).toBeVisible();
    await expect(page.locator('.meaning__text')).not.toBeEmpty();

    await context.close();
  });

  test('the 404 page and its request form work with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const response = await page.goto('/en-us/cuppcake');

    expect(response.status()).toBe(404);
    await expect(page.getByRole('link', { name: 'cupcake' })).toBeVisible();
    // The form is a plain POST, so it submits without a script.
    await expect(page.locator('form.word-request')).toHaveAttribute('method', 'post');
    await expect(page.getByRole('button', { name: 'Request this word' })).toBeVisible();

    await context.close();
  });
});

test.describe('FR-WORD-04 — the fuzzy 404', () => {
  test('cuppcake returns a genuine 404 and suggests cupcake', async ({ page }) => {
    const response = await page.goto('/en-us/cuppcake');

    expect(response.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Did you mean' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'cupcake' })).toBeVisible();
  });

  test('a suggestion links to a page that resolves', async ({ page }) => {
    await page.goto('/en-us/cuppcake');
    await page.getByRole('link', { name: 'cupcake' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'cupcake' })).toBeVisible();
  });

  test('never offers more than five suggestions', async ({ page }) => {
    await page.goto('/en-us/cuppcake');

    expect(await page.locator('.suggestion-list li').count()).toBeLessThanOrEqual(5);
  });
});

test.describe('FR-WORD-07 — responsive layout', () => {
  // These measure the rendered layout through `page.evaluate`, which needs a
  // script context. The no-javascript profile proves READING works without
  // JavaScript (FR-WORD-08 below); layout measurement is not that claim.
  test.skip(
    ({ javaScriptEnabled }) => javaScriptEnabled === false,
    'measures layout through page.evaluate',
  );

  for (const viewport of VIEWPORTS) {
    test(`no horizontal scrolling at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(WORD_URL);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  }

  test('text does not overflow its container at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(WORD_URL);

    const widest = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      return [...document.querySelectorAll('h1, p, li, a')].every(
        (element) => element.getBoundingClientRect().right <= limit + 1,
      );
    });
    expect(widest).toBe(true);
  });

  test('touch targets meet the 44 px floor at 320 px (NFR-A11Y-08)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/en-us/cuppcake');

    for (const locator of [
      page.locator('.suggestion-list a').first(),
      page.getByRole('button', { name: 'Request this word' }),
    ]) {
      const box = await locator.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('NFR-A11Y-02 — accessibility', () => {
  // axe-core is injected into the page and runs there.
  test.skip(
    ({ javaScriptEnabled }) => javaScriptEnabled === false,
    'axe-core runs inside the page',
  );

  test('the word page reports zero axe-core violations', async ({ page }) => {
    await page.goto(WORD_URL);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('the unknown-word page reports zero axe-core violations', async ({ page }) => {
    await page.goto('/en-us/cuppcake');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('B2 — the cacheable shell on the wire', () => {
  test('the shell is public, uncookied, and nonce-free', async ({ page }) => {
    const response = await page.goto(WORD_URL);
    const headers = response.headers();

    expect(headers['cache-control']).toMatch(/public/);
    expect(headers['set-cookie']).toBeUndefined();
    expect(headers['content-security-policy']).not.toMatch(/nonce-/);
  });
});
