/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

import { describe, expect, test } from '@jest/globals';

import {
  generateAnonymousId,
  generateCorrelationId,
  generateSecureToken,
  isValidAnonymousId,
} from '../../src/lib/ids.js';

describe('generateAnonymousId (FR-AUTH-01)', () => {
  test('produces a valid v4 UUID', () => {
    expect(isValidAnonymousId(generateAnonymousId())).toBe(true);
  });

  test('does not repeat across a large sample', () => {
    const sample = new Set(Array.from({ length: 5000 }, generateAnonymousId));
    expect(sample.size).toBe(5000);
  });
});

describe('isValidAnonymousId', () => {
  test.each([
    ['a plain string', 'not-a-uuid'],
    ['a v1 UUID', 'c232ab00-9414-11ec-b909-0242ac120002'],
    ['an empty string', ''],
    ['a non-string', 12345],
    ['null', null],
    ['SQL in a cookie', "' OR 1=1 --"],
  ])('rejects %s', (_label, value) => {
    expect(isValidAnonymousId(value)).toBe(false);
  });
});

describe('generateSecureToken (NFR-SEC-12)', () => {
  test('defaults to at least 128 bits of entropy', () => {
    // base64url of 32 bytes; the floor the requirement sets is 16 bytes.
    const decoded = Buffer.from(generateSecureToken(), 'base64url');
    expect(decoded.byteLength).toBeGreaterThanOrEqual(16);
    expect(decoded.byteLength).toBe(32);
  });

  test('refuses an entropy request below the 128-bit floor', () => {
    expect(() => generateSecureToken(8)).toThrow(RangeError);
    expect(() => generateSecureToken(15)).toThrow(RangeError);
  });

  test('accepts exactly the floor', () => {
    expect(Buffer.from(generateSecureToken(16), 'base64url').byteLength).toBe(16);
  });

  test('does not repeat across a large sample', () => {
    const sample = new Set(Array.from({ length: 5000 }, () => generateSecureToken()));
    expect(sample.size).toBe(5000);
  });
});

describe('generateCorrelationId', () => {
  test('is 16 hex characters and carries no data', () => {
    expect(generateCorrelationId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
