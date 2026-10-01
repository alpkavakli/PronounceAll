/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Settings and the open-source banner in a real browser (FR-SET-01/03/04,
 * FR-OSS-01/02, NFR-A11Y-02).
 */

import { randomInt, randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const BANNER = 'PronounceAll is open-source and free.';

test('the ads choice is saved and shown back; essential cookies cannot be unticked', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByLabel('pa_uid')).toBeDisabled();
  await expect(page.getByLabel('pa_uid')).toBeChecked();
  const ads = page.getByLabel('Enable ads');
  await expect(ads).not.toBeChecked();

  await ads.check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toHaveText('Your cookie preferences are saved.');
  await expect(page.getByLabel('Enable ads')).toBeChecked();
});

test('change the password from Settings, then sign in with the new one (FR-SET-02)', async ({ page }) => {
  const octet = () => randomInt(1, 255);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${octet()}.${octet()}.${octet()}` });
  const username = `zzq${randomUUID().replaceAll('-', '').slice(0, 14)}`;
  const first = `zq-${randomUUID()}`;
  const second = `zq-${randomUUID()}`;

  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(first);
  await page.getByLabel(/Without an email, we cannot recover your account/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);

  await page.goto('/settings');
  await page.getByLabel('Current password').first().fill('not my password');
  await page.getByLabel('New password').fill(second);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('alert')).toHaveText('That is not your current password.');

  await page.getByLabel('Current password').first().fill(first);
  await page.getByLabel('New password').fill(second);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toContainText('Your password is changed.');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(second);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);
});

test('the settings page reports zero axe-core violations', async ({ page, javaScriptEnabled }) => {
  test.skip(!javaScriptEnabled, 'axe-core runs as injected script');
  await page.goto('/settings');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test.describe('FR-OSS-02 — the banner', () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'Dismissal needs JavaScript; without it the banner simply stays');

  test('dismissed on one page, gone on the next for 30 minutes, back after; no cookie', async ({ page, context }) => {
    await page.goto('/en-us/cupcake');
    await expect(page.getByText(BANNER)).toBeVisible();
    const before = (await context.cookies()).map((cookie) => cookie.name).sort();

    await page.getByRole('button', { name: /Close/ }).click();
    await expect(page.getByText(BANNER)).toBeHidden();
    const until = Number(await page.evaluate(() => localStorage.getItem('pa_oss_dismissed_until')));
    expect(until - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(until - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    expect((await context.cookies()).map((cookie) => cookie.name).sort()).toEqual(before);

    await page.goto('/en-us/beauty');
    await expect(page.getByText(BANNER)).toBeHidden();

    // Thirty minutes later.
    await page.evaluate(() => localStorage.setItem('pa_oss_dismissed_until', String(Date.now() - 1)));
    await page.goto('/learnIPA');
    await expect(page.getByText(BANNER)).toBeVisible();
  });
});
