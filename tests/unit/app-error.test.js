/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

import { describe, expect, test } from '@jest/globals';

import { AppError, ERROR_CODES, GENERIC_AUTH_MESSAGE } from '../../src/errors/index.js';

describe('AppError (SDD v1.1 §6.1, C2)', () => {
  test('carries code, status, safe message, cause, and metadata', () => {
    const cause = new Error('connection reset');
    const error = new AppError({
      code: ERROR_CODES.INTERNAL,
      status: 500,
      message: 'safe',
      cause,
      meta: { attempt: 2 },
    });

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
    expect(error.status).toBe(500);
    expect(error.message).toBe('safe');
    expect(error.cause).toBe(cause);
    expect(error.meta).toEqual({ attempt: 2 });
    expect(error).toBeInstanceOf(Error);
  });

  test('auth failures always use the generic message (Foundational Decisions §2)', () => {
    const error = AppError.auth({ cause: new Error('user not found') });
    expect(error.message).toBe(GENERIC_AUTH_MESSAGE);
    expect(error.message).not.toMatch(/not found|password/i);
    expect(error.status).toBe(401);
  });

  test('rate limit carries Retry-After in metadata, not in the message', () => {
    const error = AppError.rateLimit(120);
    expect(error.status).toBe(429);
    expect(error.meta.retryAfterSeconds).toBe(120);
    expect(error.message).not.toMatch(/120/);
  });

  test('internal errors never surface the cause to the user', () => {
    const error = AppError.internal(new Error('SELECT * FROM users failed: host db.internal'));
    expect(error.status).toBe(500);
    expect(error.message).not.toMatch(/SELECT|db\.internal/);
  });

  test.each([
    ['validation', () => AppError.validation('bad input'), 400, ERROR_CODES.VALIDATION],
    ['forbidden', () => AppError.forbidden(), 403, ERROR_CODES.FORBIDDEN],
    ['notFound', () => AppError.notFound(), 404, ERROR_CODES.NOT_FOUND],
    ['conflict', () => AppError.conflict('taken'), 409, ERROR_CODES.CONFLICT],
  ])('%s maps to the status and code fixed in §6.1', (_label, build, status, code) => {
    const error = build();
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(AppError.isAppError(error)).toBe(true);
  });
});
