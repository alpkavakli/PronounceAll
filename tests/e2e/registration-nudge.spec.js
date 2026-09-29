/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The registration nudge in a real browser (FR-AUTH-17, NFR-A11Y-04).
 *
 * After the fifth save the next page suggests an account, in the fixed wording
 * of Foundational Decisions §6. The notice takes no focus and traps none, but
 * is in the tab order; dismissing it writes `pa_register_nudge_dismissed=1` to
 * localStorage and it does not come back.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WORDING = 'Create an account so you never lose your progress.';

test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'The nudge and its dismissal need JavaScript');

/** Open a page and wait for the hydration read, so an absent nudge is really absent. */
async function openHydrated(page, path) {
  const hydrated = page.waitForResponse((response) => response.url().includes('/viewer-state'));
  await page.goto(path);
  await hydrated;
  await page.waitForTimeout(100);
}

async function saveSounds(page, count) {
  await page.goto('/en-us/learnIPA');
  const controls = page.locator('button.save-control');
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    await control.click();
    await expect(control).toHaveText('Saved');
  }
}

test('four saves: no nudge; the fifth: the next page suggests an account', async ({ page }) => {
  await saveSounds(page, 4);
  await openHydrated(page, '/en-us/cupcake');
  await expect(page.getByText(WORDING)).toHaveCount(0);

  await page.goto('/en-us/learnIPA');
  const fifth = page.locator('button.save-control').nth(4);
  await fifth.click();
  await expect(fifth).toHaveText('Saved');

  // A different word page from the first visit: any next page qualifies, and
  // Playwright's Firefox stalls on a repeat visit to the same word page.
  await page.goto('/en-us/beauty');
  const nudge = page.getByRole('complementary', { name: 'Create an account' });
  await expect(nudge).toContainText(WORDING);
  await expect(nudge.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register');
});

test('non-modal: no focus taken, reachable by keyboard, no axe violations', async ({ page }) => {
  await saveSounds(page, 5);
  await page.goto('/en-us/cupcake');
  const nudge = page.getByRole('complementary', { name: 'Create an account' });
  await expect(nudge).toBeVisible();

  // It did not take focus when it appeared.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // It is in the tab order, and Tab moves on past it (no trap).
  const reached = [];
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => document.activeElement?.textContent?.trim()));
  }
  expect(reached).toContain('Dismiss');
  expect(reached.indexOf('Dismiss')).toBeLessThan(reached.length - 1);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('dismissal is remembered on this browser', async ({ page }) => {
  await saveSounds(page, 5);
  await page.goto('/en-us/cupcake');
  const nudge = page.getByRole('complementary', { name: 'Create an account' });
  await nudge.getByRole('button', { name: 'Dismiss' }).click();
  await expect(nudge).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pa_register_nudge_dismissed'))).toBe('1');

  await openHydrated(page, '/en-us/beauty');
  await expect(page.getByText(WORDING)).toHaveCount(0);
});
