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

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node src/server.js',
        url: `${BASE_URL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
