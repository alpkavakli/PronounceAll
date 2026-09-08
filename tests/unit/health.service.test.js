/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

import { describe, expect, test } from '@jest/globals';

import { checkHealth } from '../../src/services/health.service.js';

const ok = () => Promise.resolve(true);
const down = () => Promise.resolve(false);
const throws = () => Promise.reject(new Error('ECONNREFUSED'));

describe('checkHealth', () => {
  test('reports ok only when every dependency answers', async () => {
    await expect(checkHealth({ pingDatabase: ok, pingRedis: ok })).resolves.toEqual({
      status: 'ok',
      checks: { database: true, redis: true },
    });
  });

  test('reports degraded when a dependency is down', async () => {
    await expect(checkHealth({ pingDatabase: ok, pingRedis: down })).resolves.toEqual({
      status: 'degraded',
      checks: { database: true, redis: false },
    });
  });

  test('a thrown probe is a failed check, not a failed request', async () => {
    await expect(checkHealth({ pingDatabase: throws, pingRedis: throws })).resolves.toEqual({
      status: 'degraded',
      checks: { database: false, redis: false },
    });
  });
});
