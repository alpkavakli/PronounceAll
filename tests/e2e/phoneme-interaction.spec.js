/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Clickable IPA and the phoneme popover (FR-IPA-02, FR-IPA-03, FR-WORD-03,
 * FR-WORD-08, NFR-A11Y-08).
 *
 * The interesting assertions are the ones about DEGRADATION and KEYBOARD
 * operation, not the pointer happy path: the reading experience has to survive
 * with JavaScript disabled, and every control has to be operable by at least two
 * of pointer, touch, and keyboard.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WORD = '/en-us/cupcake';

test.describe('FR-IPA-02 — clickable phoneme elements', () => {
  test('each phoneme is a focusable control with a stable data-phoneme-id', async ({ page }) => {
    await page.goto(WORD);
    const phonemes = page.locator('.phoneme');

    await expect(phonemes).toHaveCount(6);

    const ids = await phonemes.evaluateAll((nodes) => nodes.map((n) => n.dataset.phonemeId));
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
    // `cupcake` is k-ʌ-p-k-eɪ-k: the three /k/ occurrences are the SAME phoneme,
    // which is what makes the id a phoneme identity rather than a position.
    expect(new Set(ids).size).toBe(4);

    // Every occurrence is a real button, so it is in the tab order natively.
    const tags = await phonemes.evaluateAll((nodes) => nodes.map((n) => n.tagName));
    expect(new Set(tags)).toEqual(new Set(['BUTTON']));
  });

  test('a diphthong is one element, not two', async ({ page }) => {
    await page.goto(WORD);
    const symbols = await page.locator('.phoneme').evaluateAll((nodes) =>
      nodes.map((n) => n.dataset.symbol),
    );
    expect(symbols).toEqual(['k', 'ʌ', 'p', 'k', 'eɪ', 'k']);
  });

  test('vowel plus R stays compositional — two elements', async ({ page }) => {
    await page.goto('/en-us/morning');
    const symbols = await page.locator('.pronunciation--primary .phoneme').evaluateAll((nodes) =>
      nodes.map((n) => n.dataset.symbol),
    );
    expect(symbols).toEqual(['m', 'ɔ', 'ɹ', 'n', 'ɪ', 'ŋ']);
  });
});

test.describe('FR-IPA-03 — the phoneme popover', () => {
  test('opens on click and shows the symbol and its example word', async ({ page }) => {
    await page.goto(WORD);
    await page.locator('.phoneme').first().click();

    const popover = page.locator('#phoneme-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('.phoneme-popover__symbol')).toHaveText('k');
    await expect(popover.locator('.phoneme-popover__example')).toContainText('cat');
  });

  test('is operable by keyboard alone (NFR-A11Y-08)', async ({ page }) => {
    await page.goto(WORD);
    const first = page.locator('.phoneme').first();

    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#phoneme-popover')).toBeVisible();

    // Escape closes it AND returns focus, so a keyboard user is not stranded.
    await page.keyboard.press('Escape');
    await expect(page.locator('#phoneme-popover')).toBeHidden();
    await expect(first).toBeFocused();
  });

  test('Space activates as well as Enter', async ({ page }) => {
    await page.goto(WORD);
    await page.locator('.phoneme').nth(1).focus();
    await page.keyboard.press(' ');
    await expect(page.locator('#phoneme-popover')).toBeVisible();
  });

  test('closes when the page is clicked elsewhere', async ({ page }) => {
    await page.goto(WORD);
    await page.locator('.phoneme').first().click();
    await expect(page.locator('#phoneme-popover')).toBeVisible();

    await page.locator('h1').click();
    await expect(page.locator('#phoneme-popover')).toBeHidden();
  });

  test('hides the replay control when no audio asset is ready', async ({ page }) => {
    // A control that cannot play is worse than none. Until the phoneme audio is
    // generated, every asset is `pending` and no replay button is offered.
    await page.goto(WORD);
    await page.locator('.phoneme').first().click();

    await expect(page.locator('.phoneme-popover__replay')).toBeHidden();
  });

  test('announces itself as a dialog opener', async ({ page }) => {
    await page.goto(WORD);
    const first = page.locator('.phoneme').first();

    await expect(first).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('FR-WORD-08 — the transcription reads without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('phonemes still render as the complete transcription', async ({ page }) => {
    await page.goto(WORD);

    const symbols = await page.locator('.phoneme').evaluateAll((nodes) =>
      nodes.map((n) => n.textContent.trim()),
    );
    expect(symbols.join('')).toBe('kʌpkeɪk');
  });

  test('no popover machinery is advertised', async ({ page }) => {
    await page.goto(WORD);
    // `aria-haspopup` is added by the script, so without it the buttons do not
    // promise an interaction that cannot happen.
    await expect(page.locator('.phoneme').first()).not.toHaveAttribute('aria-haspopup', 'dialog');
  });

  test('the syllable breakdown and meaning are still present', async ({ page }) => {
    await page.goto(WORD);
    await expect(page.locator('.syllables')).toBeVisible();
    await expect(page.locator('.meaning__text')).not.toBeEmpty();
  });
});

test.describe('NFR-A11Y — accessibility of the enhanced page', () => {
  test('the word page reports zero axe-core violations with phonemes clickable', async ({ page }) => {
    await page.goto(WORD);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('the open popover reports zero axe-core violations', async ({ page }) => {
    await page.goto(WORD);
    await page.locator('.phoneme').first().click();
    await expect(page.locator('#phoneme-popover')).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('phoneme targets meet the 44 px floor at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(WORD);

    const boxes = await page.locator('.phoneme').evaluateAll((nodes) =>
      nodes.map((n) => n.getBoundingClientRect().height),
    );
    for (const height of boxes) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('B2 — the shell is still shared and cacheable', () => {
  test('clickable phonemes did not introduce inline script, style, or a cookie', async ({ request }) => {
    const response = await request.get(WORD);
    const body = await response.text();

    expect(response.headers()['cache-control']).toContain('s-maxage');
    expect(response.headers()['set-cookie']).toBeUndefined();
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers()['content-security-policy']).not.toContain('nonce-');
    expect(body).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
    expect(body).not.toMatch(/<style[^>]*>/);
  });
});
