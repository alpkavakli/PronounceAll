/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * NFR-SEC-04: every HTML response carries the required header set, and the
 * test fails on any one missing. The CSP itself is asserted per response class
 * in the word-page suite (NFR-SEC-03); here only its presence is checked.
 */

import { afterAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { closePool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';

const app = createApp();

afterAll(async () => {
  await closePool();
  await closeRedis();
});

// Each response class and each HTML surface: the landing page, the cacheable
// word shell, the IPA page, a search, the word-not-found page and a plain 404.
const PAGES = ['/', '/en-us/cupcake', '/learnIPA', '/search?q=cupc', '/en-us/zzqnotaword', '/no/such/page'];

describe('NFR-SEC-04 — HTTP security headers', () => {
  test.each(PAGES)('%s carries every required header', async (path) => {
    const { headers } = await request(app).get(path);

    expect(headers['content-type']).toMatch(/text\/html/);
    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');

    const policy = headers['permissions-policy'];
    expect(policy).toBeDefined();
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'interest-cohort']) {
      expect(policy).toContain(`${feature}=()`);
    }
  });
});
