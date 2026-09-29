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

test('after sign-in the browser never keeps the retired identity, even when it is restored', async ({
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

  const cookie = async (name) => (await context.cookies()).find((entry) => entry.name === name)?.value;
  const mirror = () => page.evaluate(() => localStorage.getItem('pa_uid'));

  // Anonymous progress before signing in.
  await page.goto('/en-us/cupcake');
  const control = page.locator('button.save-control').first();
  await control.click();
  await expect(control).toHaveText('Saved');
  const retired = await cookie('pa_uid');
  expect(await mirror()).toBe(retired);

  // Register. That the sign-in response alone rotates pa_uid, with no page
  // visited, is proven at the HTTP level in tests/integration/account-http.test.js
  // (a browser harness cannot stop the landing page without altering cookie
  // handling). Here: whatever the landing page and bootstrap.js do, the browser
  // ends on a live identity, never the retired one.
  await page.goto('/register');
  await page.getByLabel('Username').fill(uniqueUsername());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel(/Without an email, we cannot recover your account/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/login$/);
  expect(await cookie('pa_sid')).toBeTruthy();

  await page.goto('/en-us/cupcake');
  await expect(page.locator('button.save-control').first()).toHaveText('Saved');
  // Whatever bootstrap restored from the stale mirror, hydration settled the
  // browser on a live identity, never the retired one.
  await expect.poll(mirror).not.toBe(retired);
  expect(await mirror()).toBe(await cookie('pa_uid'));

  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await cookie('pa_sid')).toBeUndefined();

  // The worst case: the retired identity is put back in both places.
  await context.addCookies([{ name: 'pa_uid', value: retired, url: page.url() }]);
  await page.evaluate((value) => localStorage.setItem('pa_uid', value), retired);

  // The server refuses it; the account's saves are not shown to this browser.
  await page.goto('/en-us/cupcake');
  await expect(page.locator('button.save-control').first()).toHaveText('Save');
  await expect.poll(mirror).not.toBe(retired);
  expect(await cookie('pa_uid')).not.toBe(retired);
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
