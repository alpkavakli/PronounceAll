/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The cookie notice and the cookie table in a real browser (FR-CONSENT-01,
 * FR-CONSENT-02, FR-CONSENT-06, FR-CONSENT-05, NFR-A11Y-12).
 *
 * The cookie table is read from the Privacy Policy document itself — the one
 * /privacy renders — so the check fails as soon as the running system sets a
 * cookie the published table does not list, or the table lists one the system
 * no longer sets.
 */

import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const POLICY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'current', 'PronounceAll_Privacy_Policy_EN_DRAFT.md');
const NOTICE = 'PronounceAll uses one strictly necessary cookie';

/** The cookie table of the policy: name → category, for cookies named in backticks. */
function cookieTable() {
  const text = readFileSync(POLICY, 'utf8').replace(/\r\n/g, '\n');
  const section = text.slice(text.indexOf('## 8. Cookies'));
  const rows = new Map();
  for (const [, name, category] of section.matchAll(/^\| `([^`]+)`[^|]*\| ([^|]+) \|/gm)) rows.set(name, category.trim());
  return rows;
}

/** Every public page a visitor reaches without signing in (NFR-PERF-01). */
const PUBLIC_ROUTES = ['/', '/en-us/cupcake', '/en-us/learnIPA', '/learnIPA', '/register', '/login', '/settings', '/privacy', '/kvkk', '/practice', '/en-us/cuppcake'];

test.describe('FR-CONSENT-01 — the acknowledgement notice', () => {
  test('shown on first visit as a landmark, linking to a Privacy Policy that answers 200', async ({ page }) => {
    await page.goto('/en-us/cupcake');
    const notice = page.getByRole('complementary', { name: 'Cookie notice' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(NOTICE);
    await expect(notice.getByRole('button', { name: /reject|decline/i })).toHaveCount(0);

    await notice.getByRole('link', { name: 'Read the Privacy Policy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  });

  test('"OK, got it" writes pa_uid_ack=1 and the notice stays gone', async ({ page, javaScriptEnabled }) => {
    test.skip(!javaScriptEnabled, 'The acknowledgement is kept in localStorage; without JavaScript the notice simply stays');
    await page.goto('/learnIPA');
    await page.getByRole('button', { name: 'OK, got it' }).click();
    await expect(page.getByText(NOTICE)).toBeHidden();
    expect(await page.evaluate(() => window.localStorage.getItem('pa_uid_ack'))).toBe('1');

    await page.goto('/settings');
    await expect(page.getByText(NOTICE)).toBeHidden();
  });

  test('without JavaScript the notice stays, with no button that cannot work', async ({ page, javaScriptEnabled }) => {
    test.skip(javaScriptEnabled, 'The no-JavaScript project only');
    await page.goto('/learnIPA');
    await expect(page.getByText(NOTICE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'OK, got it' })).toHaveCount(0);
  });
});

test.describe('FR-CONSENT-02 / FR-CONSENT-06 — the cookies actually set', () => {
  test('the policy table lists pa_uid and pa_sid as strictly necessary', () => {
    const table = cookieTable();
    expect(table.get('pa_uid')).toBe('Strictly necessary');
    expect(table.get('pa_sid')).toBe('Strictly necessary');
  });

  test('visiting every public page signed out sets only strictly necessary cookies from the table', async ({ page, context }) => {
    const table = cookieTable();
    for (const route of PUBLIC_ROUTES) await page.goto(route);
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names).toContain('pa_uid');
    for (const name of names) expect(table.get(name)).toBe('Strictly necessary');
  });

  test('a whole journey — browse, register, practice, sign out, sign in — sets exactly the table, nothing else', async ({ page, context }) => {
    const octet = () => randomInt(1, 255);
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${octet()}.${octet()}.${octet()}` });
    const seen = new Set();
    page.on('response', (response) => {
      for (const line of (response.headers()['set-cookie'] ?? '').split('\n')) if (line.includes('=')) seen.add(line.split('=')[0].trim());
    });

    await page.goto('/en-us/cupcake');
    await page.goto('/settings');
    const username = `zzk${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const password = `zq-${randomUUID()}`;
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByLabel(/Without an email, we cannot recover your account/).check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);
    await page.goto('/practice');
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign out' }).click();
    // Let the sign-out land before navigating, or the POST can be abandoned.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    await page.goto('/login');
    await page.getByLabel('Username or email').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('status')).toContainText(`Signed in as ${username}`);

    for (const cookie of await context.cookies()) seen.add(cookie.name);
    // Cloudflare's cookies are set at the edge, which this local run has none of.
    const expected = [...cookieTable().keys()].sort();
    expect([...seen].sort()).toEqual(expected);
  });
});

test.describe('NFR-A11Y-12 — no banner hides the focused control', () => {
  for (const route of ['/en-us/cupcake', '/settings', '/privacy']) {
    test(`tabbing through ${route} at 320 × 568 keeps every focused control at least partly in view`, async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', 'WebKit does not move focus to links with Tab by default');
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(route);
      await expect(page.getByText(NOTICE)).toBeVisible();
      await expect(page.getByText('PronounceAll is open-source and free.')).toBeVisible();

      const seen = new Set();
      for (let step = 0; step < 120; step += 1) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const element = document.activeElement;
          if (!element || element === document.body) return null;
          const box = element.getBoundingClientRect();
          const visible = box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
          return { key: `${element.tagName}:${element.textContent?.trim().slice(0, 40)}:${box.top + window.scrollY}`, visible };
        });
        if (!focused) continue;
        if (seen.has(focused.key)) break;
        seen.add(focused.key);
        expect(focused.visible, focused.key).toBe(true);
      }
      expect(seen.size).toBeGreaterThan(3);
    });
  }
});

test('the legal pages report zero axe-core violations', async ({ page, javaScriptEnabled }) => {
  test.skip(!javaScriptEnabled, 'axe-core runs as injected script');
  for (const route of ['/privacy', '/kvkk']) {
    await page.goto(route);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});
