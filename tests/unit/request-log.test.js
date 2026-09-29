/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Search text stays out of the application logs (Privacy Policy §3.4, Threat
 * Model F2). The query string is where `/search?q=…` carries it, so a logged
 * URL is the path alone.
 */

import { describe, expect, test } from '@jest/globals';

import { pathWithoutQuery } from '../../src/lib/http.js';
import { REQUEST_LOG_SERIALIZERS } from '../../src/middleware/request-context.js';

describe('pathWithoutQuery', () => {
  test.each([
    ['/search?q=secret+words', '/search'],
    ['/en-us/cupcake?requested=new', '/en-us/cupcake'],
    ['/search?', '/search'],
    ['/en-us/cupcake', '/en-us/cupcake'],
    ['/', '/'],
  ])('%s → %s', (url, expected) => {
    expect(pathWithoutQuery(url)).toBe(expected);
  });

  test('passes a missing URL through unchanged', () => {
    expect(pathWithoutQuery(undefined)).toBeUndefined();
  });
});

describe('the request log line', () => {
  test('records the path of a search, never its query', () => {
    const line = REQUEST_LOG_SERIALIZERS.req({ id: 'c1', method: 'GET', url: '/search?q=private+text' });

    expect(line).toEqual({ id: 'c1', method: 'GET', url: '/search' });
    expect(JSON.stringify(line)).not.toContain('private');
  });
});
