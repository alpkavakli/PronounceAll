/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Jest configuration (SDD v1.1 §7.8).
 *
 * Two projects, matching the pyramid the SRS ties its acceptance criteria to:
 * unit tests cover pure service and helper logic in isolation, integration
 * tests cover routes through Supertest. End-to-end tests are Playwright and
 * live outside Jest.
 */

export default {
  testEnvironment: 'node',
  transform: {},
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: {},
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform: {},
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
    },
  ],
};
