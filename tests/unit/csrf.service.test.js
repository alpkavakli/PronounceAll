/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The stateless CSRF token, the same-origin rule, and the safe return path
 * (FR-AUTH-20, FR-SAVE-07; SDD v1.1 §6.6).
 */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import {
  issueConfirmationCredentials,
  issueCsrfToken,
  isSameOrigin,
  verifyCsrfToken,
} from '../../src/services/csrf.service.js';
import { safeReturnPath } from '../../src/validators/progress.validator.js';

const SECRET = 'a-test-secret-that-is-long-enough-for-hmac';
const ALICE = '6f1c0f0e-3c1a-4f7e-9d2b-1a2b3c4d5e6f';
const BOB = '0b7d7a52-9a3e-4c1f-8e6d-6a5b4c3d2e1f';

describe('CSRF token', () => {
  it('is bound to the purpose- and version-prefixed identity, not the bare UUID', () => {
    const token = issueCsrfToken(SECRET, ALICE);
    expect(token).toBe(createHmac('sha256', SECRET).update(`csrf:v1:anon:${ALICE}`).digest('base64url'));
    expect(token).not.toBe(createHmac('sha256', SECRET).update(ALICE).digest('base64url'));
  });

  it('verifies only for the identity and secret it was issued with', () => {
    const token = issueCsrfToken(SECRET, ALICE);
    expect(verifyCsrfToken(SECRET, ALICE, token)).toBe(true);
    expect(verifyCsrfToken(SECRET, BOB, token)).toBe(false);
    expect(verifyCsrfToken(`${SECRET}-rotated`, ALICE, token)).toBe(false);
  });

  it('rejects missing, truncated and tampered tokens without throwing', () => {
    const token = issueCsrfToken(SECRET, ALICE);
    expect(verifyCsrfToken(SECRET, ALICE, undefined)).toBe(false);
    expect(verifyCsrfToken(SECRET, ALICE, '')).toBe(false);
    expect(verifyCsrfToken(SECRET, ALICE, token.slice(1))).toBe(false);
    expect(verifyCsrfToken(SECRET, ALICE, `${token.slice(0, -1)}A`)).not.toBe(true);
    expect(verifyCsrfToken(SECRET, null, token)).toBe(false);
  });

  it('issues confirmation credentials as two separate values', () => {
    const first = issueConfirmationCredentials(SECRET, ALICE);
    const second = issueConfirmationCredentials(SECRET, ALICE);
    expect(first.csrfToken).toBe(second.csrfToken);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('isSameOrigin', () => {
  const allowedOrigins = ['http://localhost:3000'];

  it('accepts a matching Origin and refuses a foreign one', () => {
    expect(isSameOrigin({ origin: 'http://localhost:3000', allowedOrigins })).toBe(true);
    expect(isSameOrigin({ origin: 'https://evil.example', allowedOrigins })).toBe(false);
    expect(isSameOrigin({ origin: 'null', allowedOrigins })).toBe(false);
  });

  it('falls back to Sec-Fetch-Site only when Origin is absent, and refuses neither', () => {
    expect(isSameOrigin({ fetchSite: 'same-origin', allowedOrigins })).toBe(true);
    expect(isSameOrigin({ fetchSite: 'cross-site', allowedOrigins })).toBe(false);
    expect(isSameOrigin({ allowedOrigins })).toBe(false);
  });
});

describe('safeReturnPath', () => {
  it.each([
    ['/en-us/cupcake', '/en-us/cupcake'],
    ['/en-us/learnIPA?x=1', '/en-us/learnIPA?x=1'],
    ['//evil.example/path', '/'],
    ['https://evil.example', '/'],
    [`/${String.fromCharCode(92)}evil.example`, '/'],
    ['/a\nb', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    [undefined, '/'],
  ])('%j -> %j', (raw, expected) => {
    expect(safeReturnPath(raw)).toBe(expected);
  });
});
