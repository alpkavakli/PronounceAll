/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Google sign-in in a real browser (FR-AUTH-04a, NFR-PRIV-05, NFR-A11Y-14).
 *
 * The whole Google flow is covered against a fake provider in
 * tests/integration/account-google-http.test.js; no test here reaches Google.
 * What only a browser can show: loading the sign-in and registration pages
 * sends nothing to Google, and — when the server has Google configured —
 * "Continue with Google" is a plain link that works without JavaScript and is
 * the only thing that leads there.
 */

import { expect, test } from '@playwright/test';

const GOOGLE_HOSTS = /(^|\.)(google\.com|googleapis\.com|gstatic\.com|googleusercontent\.com)$/;

test('the sign-in and registration pages load nothing from Google (NFR-PRIV-05)', async ({ page }) => {
  const googleRequests = [];
  page.on('request', (request) => {
    if (GOOGLE_HOSTS.test(new URL(request.url()).hostname)) googleRequests.push(request.url());
  });

  for (const path of ['/login', '/register']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(googleRequests).toEqual([]);
});

test('when offered, "Continue with Google" is a plain link to the start of the flow', async ({ page }) => {
  await page.goto('/login');
  const link = page.getByRole('link', { name: 'Continue with Google' });
  test.skip((await link.count()) === 0, 'Google is not configured on this server (GOOGLE_CLIENT_ID/SECRET unset)');

  await expect(link).toHaveAttribute('href', '/auth/google');
  // Read the redirect without following it: nothing is sent to Google.
  const redirect = await page.request.get('/auth/google', { maxRedirects: 0 });
  expect(redirect.status()).toBe(303);
  const target = new URL(redirect.headers().location);
  expect(target.hostname).toBe('accounts.google.com');
  expect(target.searchParams.get('scope')).toBe('openid email profile');
});
