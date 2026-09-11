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
      // Run with `--runInBand` (see the `test:integration` script). Every
      // integration suite shares ONE database: some insert fixture rows, others
      // assert corpus-wide invariants, and a few mutate a real row and restore
      // it. In parallel those overlap — a fixture word with no
      // `pronunciation_phonemes` makes the seed-coverage invariant fail, and a
      // suite that detaches a word's audio makes another suite's render
      // assertion fail — with the failure landing on whichever suite happened
      // to read mid-flight. The fault is the shared fixture, not the assertion,
      // so the suites run serially rather than being weakened to tolerate each
      // other. This mirrors the e2e guidance to use `--workers=1` locally.
      displayName: 'integration',
      testEnvironment: 'node',
      transform: {},
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
    },
  ],
};
