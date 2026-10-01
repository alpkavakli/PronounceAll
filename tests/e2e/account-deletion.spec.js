/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Deleting an account in a real browser, and getting it back (FR-SET-07,
 * FR-SET-09, NFR-A11Y-02). Plain forms: the same in every project, with or
 * without JavaScript.
 */

import { randomInt, randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function registerAndSignIn(page) {
  const octet = () => randomInt(1, 255);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${octet()}.${octet()}.${octet()}` });
  const username = `zzx${randomUUID().replaceAll('-', '').slice(0, 14)}`;
  const password = `zq-${randomUUID()}`;
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel(/Without an email, we cannot recover your account/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);
  return { username, password };
}

test('delete with 30 days to change your mind, then sign in and get the account back', async ({ page }) => {
  const { username, password } = await registerAndSignIn(page);

  await page.goto('/settings');
  await page.getByRole('link', { name: 'Delete my account…' }).click();
  await expect(page.getByRole('heading', { name: 'Delete your account' })).toBeVisible();

  // A wrong password stops the flow at step 1.
  await page.getByLabel('Your password').fill('not my password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('That is not your current password.');
  await expect(page.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);

  await page.getByLabel('Your password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Delete, with 30 days to change my mind').check();
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account is deleted' })).toBeVisible();

  // Signed out everywhere: the account page offers sign-in again.
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Welcome back. Your account was restored')).toBeVisible();
  await expect(page.getByRole('status').first()).toContainText(`Signed in as ${username}`);
});

test('both deletion steps report zero axe-core violations', async ({ page, javaScriptEnabled }) => {
  test.skip(!javaScriptEnabled, 'axe-core runs as injected script');
  const { password } = await registerAndSignIn(page);

  await page.goto('/settings/delete');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByLabel('Your password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
