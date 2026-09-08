/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Iteration 0 smoke coverage. It asserts the foundation properties that must
 * hold for every page the later iterations add: the page renders, the
 * `pa_uid` cookie behaves as FR-AUTH-01 requires, and reading works with
 * JavaScript switched off (NFR-COMPAT-03).
 */

import { expect, test } from '@playwright/test';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('the landing page renders and names the seeded variant', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'PronounceAll' })).toBeVisible();
  await expect(page.getByText('American English')).toBeVisible();
});

test('the page reads correctly with JavaScript disabled (NFR-COMPAT-03)', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'PronounceAll' })).toBeVisible();
  await expect(page.getByText('American English')).toBeVisible();

  await context.close();
});

test('a fresh visitor is issued a valid pa_uid cookie (FR-AUTH-01)', async ({ page, context }) => {
  const response = await page.goto('/');

  // The attributes are asserted on the wire, which is what the FR-AUTH-01
  // acceptance criterion names. A browser cookie jar normalises them — WebKit
  // reports SameSite as "None" for a Lax cookie — so the jar is the wrong place
  // to assert a header contract.
  const setCookie = (await response.headerValue('set-cookie')) ?? '';
  const paUid = setCookie.split('\n').find((line) => line.startsWith('pa_uid='));

  expect(paUid).toBeDefined();
  expect(paUid).toMatch(/Max-Age=63072000/);
  expect(paUid).toMatch(/Path=\//);
  expect(paUid).toMatch(/SameSite=Lax/);

  // What the browser actually stored, which every engine agrees on.
  const cookie = (await context.cookies()).find((c) => c.name === 'pa_uid');
  expect(cookie).toBeDefined();
  expect(cookie.value).toMatch(UUID_V4);
  expect(cookie.path).toBe('/');
  // FR-AUTH-02's localStorage mirror needs JavaScript read access.
  expect(cookie.httpOnly).toBe(false);
});

test('the identity survives a reload rather than being reissued (FR-AUTH-01)', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const first = (await context.cookies()).find((c) => c.name === 'pa_uid').value;

  await page.reload();
  const second = (await context.cookies()).find((c) => c.name === 'pa_uid').value;

  expect(second).toBe(first);
});

test('the cookie is mirrored into localStorage (FR-AUTH-02)', async ({ page, context }, testInfo) => {
  // FR-AUTH-02 is a client-script behaviour; the no-javascript project exists
  // to prove the *reading* path survives without it (NFR-COMPAT-03), not this.
  test.skip(testInfo.project.name === 'no-javascript', 'requires the bootstrap script');

  await page.goto('/');

  const cookie = (await context.cookies()).find((c) => c.name === 'pa_uid').value;
  const mirrored = await page.evaluate(() => window.localStorage.getItem('pa_uid'));

  expect(mirrored).toBe(cookie);
});

test('clearing cookies but not localStorage rehydrates the same identity (FR-AUTH-02)', async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name === 'no-javascript', 'requires the bootstrap script');

  await page.goto('/');
  const original = (await context.cookies()).find((c) => c.name === 'pa_uid').value;

  await context.clearCookies();
  await page.reload();

  const rehydrated = await page.evaluate(() => {
    const match = document.cookie.match(/(?:^|;\s*)pa_uid=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  });

  expect(rehydrated).toBe(original);
});

test('the health endpoint reports the dependency state', async ({ request }) => {
  const response = await request.get('/health');

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({
    status: 'ok',
    checks: { database: true, redis: true },
  });
});
