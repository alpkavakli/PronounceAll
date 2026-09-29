/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * FR-SAVE-06 in a real browser: cookies refused.
 *
 * Chromium offers no per-test "block cookies" switch, so refusal is simulated
 * at both ends a browser would enforce it: every `Set-Cookie` is stripped from
 * responses, and `document.cookie` neither stores nor returns anything. The
 * identity cookie can therefore never be retained.
 *
 * The browser test has no database access, so "no profile or event" is shown
 * by the absence of any state-changing request; that a request without the
 * identity cookie writes nothing is proven directly in
 * `tests/integration/save-http.test.js`.
 */

import { expect, test } from '@playwright/test';

const WORD = '/en-us/cupcake';

test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'FR-SAVE-06 is detected by the page script');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => {},
    });
  });
  await page.route('**/*', async (route) => {
    // WebKit routes `blob:` URLs here too, which cannot be fetched and carry
    // no cookies; only HTTP responses need the `Set-Cookie` stripped.
    if (!route.request().url().startsWith('http')) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['set-cookie'];
    await route.fulfill({ response, headers });
  });
});

test('save is disabled with the explanation, and nothing state-changing is sent', async ({ page }) => {
  const writes = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(request.url());
  });

  await page.goto(WORD);
  const control = page.locator('button.save-control').first();
  await expect(control).toBeDisabled();
  await expect(control).toHaveAttribute('aria-label', 'Enable cookies to save your progress.');
  await expect(control).toHaveAttribute('title', 'Enable cookies to save your progress.');

  await control.click({ force: true });
  await page.locator('.phoneme').first().click();
  await expect(page.locator('#phoneme-popover button.save-control')).toBeDisabled();
  await page.waitForTimeout(1000);

  expect(writes).toEqual([]);
});

test('reading and audio still work', async ({ page }) => {
  await page.goto(WORD);
  await expect(page.locator('h1.word__headword')).toHaveText('cupcake');
  await expect(page.locator('.meaning__text')).not.toBeEmpty();
  await expect(page.locator('.phoneme').first()).toBeVisible();

  const played = page.evaluate(
    () =>
      new Promise((resolve) => {
        const original = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function play(...args) {
          this.addEventListener('playing', () => resolve(true), { once: true });
          return original.apply(this, args);
        };
      }),
  );
  await page.locator('.phoneme').first().click();
  await expect(page.locator('#phoneme-popover')).toBeVisible();
  expect(await played).toBe(true);
});
