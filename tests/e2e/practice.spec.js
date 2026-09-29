/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Practice in a real browser (FR-PRACTICE-01/03/06, NFR-COMPAT-03,
 * NFR-A11Y-02). Runs with and without JavaScript: every turn is a plain form.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Save a word through the no-JavaScript confirmation page, which works in both profiles. */
async function saveWord(page, slug) {
  await page.goto(`/en-us/${slug}`);
  const id = await page.locator('[data-save-control][data-target-kind="word"]').first().getAttribute('data-target-id');
  await page.goto(`/save/confirm?kind=word&id=${id}&return=/`);
  await page.getByRole('button', { name: 'Save' }).click();
  // The home page exactly: the confirmation page's own URL also ends in "/".
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
}

test('nothing saved: the empty state links back to browsing', async ({ page }) => {
  await page.goto('/practice');
  await expect(page.getByText('You have not saved any words yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse words' })).toHaveAttribute('href', '/');
});

test('a session: one word at a time with its audio, then a summary and "nothing due"', async ({ page, javaScriptEnabled }) => {
  // FR-PRACTICE-03: no microphone, ever. Count any attempt to ask for one.
  await page.addInitScript(() => {
    window.__microphoneRequests = 0;
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia = () => {
        window.__microphoneRequests += 1;
        return Promise.reject(new Error('blocked by test'));
      };
    }
  });

  await saveWord(page, 'cupcake');
  await saveWord(page, 'beauty');

  await page.goto('/practice');
  await expect(page.getByText('Word 1 of 2')).toBeVisible();
  await expect(page.locator('.pronunciation-list')).toBeVisible();
  await expect(page.locator('.phoneme').first()).toBeVisible();
  await page.getByRole('button', { name: 'I got it right' }).click();

  await expect(page.getByText('Word 2 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'I got it right' }).click();

  await expect(page.getByRole('status')).toContainText('Session complete: 2 of 2 answers right.');
  await expect(page.getByText('You have no words due right now.')).toBeVisible();

  await page.getByRole('link', { name: "Want to see what's coming up?" }).click();
  await expect(page.locator('.practice__upcoming li')).toHaveCount(2);
  if (javaScriptEnabled) expect(await page.evaluate(() => window.__microphoneRequests)).toBe(0);
});

test('a wrong answer brings the word back in the same session', async ({ page }) => {
  await saveWord(page, 'cupcake');
  await page.goto('/practice');
  const headword = await page.locator('h1.word__headword').textContent();
  await page.getByRole('button', { name: 'I got it wrong' }).click();

  await expect(page.getByText('Word 2 of 2')).toBeVisible();
  await expect(page.locator('h1.word__headword')).toHaveText(headword);
});

test('the practice turn reports zero axe-core violations', async ({ page, javaScriptEnabled }) => {
  test.skip(!javaScriptEnabled, 'axe-core runs as injected script');
  await saveWord(page, 'cupcake');
  await page.goto('/practice');
  await expect(page.getByRole('button', { name: 'I got it right' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
