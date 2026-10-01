/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The WCAG 2.2 AA audit (NFR-A11Y-01; Charter SC4): axe-core with the
 * WCAG 2.0, 2.1 and 2.2 A/AA rule tags on every page of the NFR-PERF-01 list,
 * plus the signed-in and in-use states that carry the controls the requirement
 * names (the save control, the practice session). Zero violations.
 *
 * axe-core checks what can be checked automatically; the rest is the dated,
 * signed manual review in docs/a11y/.
 */

import { randomInt, randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** NFR-PERF-01: the public page list. */
const PAGES = ['/', '/en-us/cupcake', '/en-us/learnIPA', '/learnIPA', '/register', '/login', '/settings', '/privacy', '/kvkk', '/practice', '/en-us/cuppcake'];

async function audit(page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  return results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target.join(' ')) }));
}

test.describe('NFR-A11Y-01 — WCAG 2.2 AA, automated', () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'axe-core runs as injected script');

  for (const path of PAGES) {
    test(`${path}: zero WCAG 2.2 A/AA violations`, async ({ page }) => {
      await page.goto(path);
      expect(await audit(page)).toEqual([]);
    });
  }

  test('signed in, with a word saved: the account page, settings and the practice page', async ({ page }) => {
    const octet = () => randomInt(1, 255);
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${octet()}.${octet()}.${octet()}` });
    await page.goto('/en-us/cupcake');
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await expect(page.getByRole('button', { name: /^Saved/ }).first()).toBeVisible();

    await page.goto('/register');
    await page.getByLabel('Username').fill(`zza${randomUUID().replaceAll('-', '').slice(0, 14)}`);
    await page.getByLabel('Password').fill(`zq-${randomUUID()}`);
    await page.getByLabel(/Without an email, we cannot recover your account/).check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toContainText('Signed in as');
    expect(await audit(page)).toEqual([]);

    await page.goto('/settings');
    expect(await audit(page)).toEqual([]);

    await page.goto('/practice');
    await expect(page.locator('main')).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test('the word page with the phoneme popover open', async ({ page }) => {
    await page.goto('/en-us/cupcake');
    await page.locator('[data-phoneme-id]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });
});
