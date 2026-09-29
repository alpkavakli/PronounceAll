/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * End-to-end test configuration (SDD v1.1 §7.8).
 *
 * The SRS acceptance criteria fix the demanding cases: multi-browser runs
 * including WebKit for Safari, no-JavaScript profiles for progressive
 * enhancement, and axe-core runs for accessibility. The first two are
 * configured here as projects; accessibility assertions arrive with the pages
 * that have content to assert against (Iteration 1).
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    {
      // NFR-COMPAT-03: reading must work without JavaScript.
      name: 'no-javascript',
      use: { ...devices['Desktop Chrome'], javaScriptEnabled: false },
    },
  ],

  // One trusted proxy hop, so a test can present its own client address in
  // `X-Forwarded-For`. The per-IP limits (FR-AUTH-15: 3 registrations per hour)
  // then run unchanged while each test is its own "client"; without this every
  // browser test shares 127.0.0.1 and the suite exhausts the limit on itself.
  // A server started by hand for E2E_BASE_URL needs TRUST_PROXY_HOPS=1 too.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node src/server.js',
        // Placeholder Google credentials (development only) so the Google
        // entry point is rendered and its redirect can be checked; no test
        // follows the redirect, so nothing ever reaches Google.
        env: {
          TRUST_PROXY_HOPS: '1',
          GOOGLE_CLIENT_ID: 'e2e-placeholder.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'e2e-placeholder-not-a-secret',
        },
        url: `${BASE_URL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
