/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Accounts in a real browser (FR-AUTH-04/12/18, FR-CONSENT-04, FR-SET-06;
 * SDD v1.1 §5.1).
 *
 * The cross-layer properties a server test cannot see: that the sign-in landing
 * makes the browser adopt the fresh `pa_uid` rather than restore the retired one
 * from its localStorage mirror, and that a word saved while signed out is still
 * saved — now through the account — after registering.
 */

import { randomInt, randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Random per run: the dev server checks the real HIBP API, where any well-known
// example password (including xkcd's) is, correctly, refused as breached.
const PASSWORD = `zq-${randomUUID()}`;

// Each test is its own client address (see playwright.config.js), so the
// per-IP registration limit applies per test rather than to the whole suite.
test.beforeEach(async ({ page }) => {
  const octet = () => randomInt(1, 255);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${octet()}.${octet()}.${octet()}` });
});

const uniqueUsername = () => `zze${randomUUID().replaceAll('-', '').slice(0, 14)}`;

async function registerThroughForm(page, username) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel(/Without an email, we cannot recover your account/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);
}

test('register, keep what was saved signed out, adopt the new identity, sign out', async ({
  page,
  context,
  javaScriptEnabled,
  browserName,
}) => {
  test.skip(!javaScriptEnabled, 'Saving and the localStorage mirror need JavaScript');
  // Playwright's Firefox on Windows leaves the repeat visit to the word page
  // marked as a pending navigation, so every later locator waits forever; the
  // saved page snapshot shows the page itself in the correct state. Chromium and
  // WebKit run this flow; Firefox runs the other account tests.
  test.skip(browserName === 'firefox', 'Playwright Firefox stalls on the repeat navigation (harness, not the page)');

  await page.goto('/en-us/cupcake');
  const control = page.locator('button.save-control').first();
  await control.click();
  await expect(control).toHaveText('Saved');
  const before = (await context.cookies()).find((cookie) => cookie.name === 'pa_uid').value;

  await registerThroughForm(page, uniqueUsername());

  // §5.1: the carried identity was bound and retired; the page adopted the new
  // one instead of restoring the old one from localStorage.
  const after = (await context.cookies()).find((cookie) => cookie.name === 'pa_uid').value;
  expect(after).not.toBe(before);
  // bootstrap.js is a deferred module; it may run just after the text renders.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pa_uid'))).toBe(after);

  // Still saved, now through the account.
  await page.goto('/en-us/cupcake');
  await expect(page.locator('button.save-control').first()).toHaveText('Saved');

  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await context.cookies()).find((cookie) => cookie.name === 'pa_sid')).toBeUndefined();

  // Signed out on a fresh identity: the account's saves are no longer shown.
  await page.goto('/en-us/cupcake');
  await expect(page.locator('button.save-control').first()).toHaveText('Save');
});

test('registration and sign-in work without JavaScript', async ({ page }) => {
  const username = uniqueUsername();
  await registerThroughForm(page, username);

  await page.getByRole('button', { name: 'Sign out' }).click();
  // Wait for the sign-out to land before navigating: a navigation started
  // earlier cancels the pending form POST (WebKit does exactly that).
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);
});

test('a failed sign-in shows the one generic message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('zzenobodyhere');
  await page.getByLabel('Password').fill('not a real password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid username/email or password');
});

test('the account pages report zero axe-core violations', async ({ page, javaScriptEnabled }) => {
  test.skip(!javaScriptEnabled, 'axe-core runs as injected script');
  for (const path of ['/register', '/login']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, path).toEqual([]);
  }
});
