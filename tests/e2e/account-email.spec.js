/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Email verification and password reset through a real SMTP hop (FR-AUTH-09,
 * FR-AUTH-11). The server sends to the development Mailpit catcher; the test
 * reads the message from Mailpit's API and follows the link as a person would.
 * Skipped, with the reason, when Mailpit is not running.
 */

import { randomInt, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
const PASSWORD = `zq-${randomUUID()}`;
const NEW_PASSWORD = `zq-${randomUUID()}`;

async function mailpitIsUp() {
  try {
    return (await fetch(`${MAILPIT}/api/v1/info`)).ok;
  } catch {
    return false;
  }
}

/** The first link to `path` in the newest message to `to`, waiting for it to arrive. */
async function linkFromMailpit(to, path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const search = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    for (const summary of search.messages ?? []) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${summary.ID}`)).json();
      const link = message.Text.split(/\s+/).find((word) => /^https?:\/\//.test(word) && word.includes(`${path}?token=`));
      if (link) return new URL(link);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No ${path} link arrived for ${to}`);
}

test.beforeEach(async ({ page }) => {
  test.skip(!(await mailpitIsUp()), 'Mailpit is not running (docker compose up -d mailpit)');
  const octet = () => randomInt(1, 255);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${octet()}.${octet()}.${octet()}` });
});

test('register with an email, confirm it from the inbox, sign in, reset the password', async ({ page }) => {
  const username = `zzp${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const email = `${username}@example.test`;

  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('We have sent you a link to confirm your email address.');

  // Blocked until confirmed, with the resend offer.
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Please confirm your email address before signing in.');

  // Follow the emailed link on this server.
  const verify = await linkFromMailpit(email, '/verify-email');
  await page.goto(`${verify.pathname}${verify.search}`);
  await expect(page.getByRole('status')).toContainText('your email address is confirmed');
  // Confirming does not sign in, and the token has left the address bar.
  expect(page.url()).not.toContain('token=');

  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Username or email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);

  // Reset the password from the sign-in page.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/reset-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('a reset link is on its way');

  const reset = await linkFromMailpit(email, '/reset-password/confirm');
  await page.goto(`${reset.pathname}${reset.search}`);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('status')).toContainText('Your password was changed and every device was signed out.');

  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);
});
