/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The save control in a real browser (FR-SAVE-01, FR-SAVE-02, FR-SAVE-07,
 * FR-AUTH-20).
 *
 * With JavaScript the server-rendered link becomes a button that saves, then
 * tags through the choice menu, and the state survives a reload. Without
 * JavaScript the same link goes through the confirmation page and returns to
 * the word. Each test starts from a fresh browser context, so a fresh identity.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WORD = '/en-us/cupcake';

test.describe('with JavaScript', () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'JavaScript flow');

  test('save, tag learned, and the state survives a reload', async ({ page }) => {
    await page.goto(WORD);
    const control = page.locator('button.save-control').first();
    await expect(control).toHaveText('Save');
    await expect(control).toHaveAttribute('aria-pressed', 'false');

    await control.click();
    await expect(control).toHaveText('Saved');
    await expect(control).toHaveAttribute('aria-pressed', 'true');

    await control.click();
    const menu = page.locator('.save-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Learned' }).click();
    await expect(control).toHaveText('Learned');

    await page.reload();
    await expect(page.locator('button.save-control').first()).toHaveText('Learned');
  });

  test('Remove returns the word to unsaved', async ({ page }) => {
    await page.goto(WORD);
    const control = page.locator('button.save-control').first();
    await control.click();
    await expect(control).toHaveText('Saved');
    await control.click();
    await page.locator('.save-menu').getByRole('button', { name: 'Remove' }).click();
    await expect(control).toHaveText('Save');
  });

  test('the phoneme popover carries the same control', async ({ page }) => {
    await page.goto(WORD);
    await expect(page.locator('button.save-control').first()).toBeVisible();
    await page.locator('.phoneme').first().click();
    const popoverControl = page.locator('#phoneme-popover button.save-control');
    await expect(popoverControl).toHaveText('Save');
    await popoverControl.click();
    await expect(popoverControl).toHaveText('Saved');
    await expect(page.locator('#phoneme-popover')).toBeVisible();
  });

  test('the word page with the control reports zero axe-core violations', async ({ page }) => {
    await page.goto(WORD);
    await expect(page.locator('button.save-control').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('without JavaScript (FR-SAVE-07)', () => {
  test.skip(({ javaScriptEnabled }) => javaScriptEnabled, 'no-JavaScript flow');

  test('save goes through the confirmation page and returns to the word', async ({ page }) => {
    await page.goto(WORD);
    await page.getByRole('link', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/save\/confirm\?/);
    await expect(page.locator('h1')).toHaveText('Save');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(new RegExp(`${WORD}$`));

    await page.getByRole('link', { name: 'Save' }).click();
    await expect(page.locator('h1')).toHaveText('Remove from saved');
  });
});
