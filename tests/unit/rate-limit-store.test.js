/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Rate-limit counters (FR-WORD-05, Foundational Decisions §10.3, NFR-SEC-11).
 *
 * The invariants under test are the boundary itself, the ROLLING nature of the
 * window — FR-WORD-05 says "within a rolling hour", and a fixed window would
 * admit twice the limit across a boundary — the `Retry-After` value, key
 * isolation, and the documented fail-open behaviour when the store is down.
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  createInMemoryRateLimitStore,
  createRedisRateLimitStore,
} from '../../src/lib/rate-limit-store.js';

const LIMIT = 10;
const WINDOW = 3600;

describe('in-memory store', () => {
  /** @type {ReturnType<typeof createInMemoryRateLimitStore>} */
  let store;

  beforeEach(() => {
    jest.useRealTimers();
    store = createInMemoryRateLimitStore();
  });

  test('admits exactly the limit and denies the next request', async () => {
    for (let attempt = 1; attempt <= LIMIT; attempt += 1) {
      const decision = await store.consume('word-request:uuid-a', LIMIT, WINDOW);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(LIMIT - attempt);
    }

    // The 11th submission within the hour, per the FR-WORD-05 criterion.
    const denied = await store.consume('word-request:uuid-a', LIMIT, WINDOW);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  test('a denial carries a positive Retry-After within the window', async () => {
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await store.consume('word-request:uuid-b', LIMIT, WINDOW);
    }
    const denied = await store.consume('word-request:uuid-b', LIMIT, WINDOW);

    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(WINDOW);
  });

  test('keys are isolated, so one visitor cannot exhaust another visitor', async () => {
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await store.consume('word-request:uuid-c', LIMIT, WINDOW);
    }
    expect((await store.consume('word-request:uuid-c', LIMIT, WINDOW)).allowed).toBe(false);
    expect((await store.consume('word-request:uuid-d', LIMIT, WINDOW)).allowed).toBe(true);
  });

  test('buckets are isolated, so one endpoint does not consume another', async () => {
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await store.consume('word-request:uuid-e', LIMIT, WINDOW);
    }
    expect((await store.consume('other-bucket:uuid-e', LIMIT, WINDOW)).allowed).toBe(true);
  });

  test('the window ROLLS: an old request expires and frees exactly one slot', async () => {
    const store2 = createInMemoryRateLimitStore();
    const shortWindow = 1;

    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await store2.consume('rolling:uuid', LIMIT, shortWindow);
    }
    expect((await store2.consume('rolling:uuid', LIMIT, shortWindow)).allowed).toBe(false);

    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });

    // Every earlier request has now aged out of the window, so the visitor is
    // admitted again — and the counter did not simply reset at a fixed
    // boundary, it slid.
    expect((await store2.consume('rolling:uuid', LIMIT, shortWindow)).allowed).toBe(true);
  });
});

describe('Redis store', () => {
  test('reads the allow, remaining, and retry values the script returns', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([1, 7, 0]) };
    const store = createRedisRateLimitStore(redis);

    const decision = await store.consume('word-request:uuid', LIMIT, WINDOW);

    expect(decision).toEqual({ allowed: true, remaining: 7, retryAfterSeconds: 0 });
    // The whole window is evaluated in ONE server-side call, so two concurrent
    // submissions cannot both read a count below the limit.
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  test('converts the denial to a whole-second Retry-After, never zero', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([0, 0, 1500]) };
    const store = createRedisRateLimitStore(redis);

    const decision = await store.consume('word-request:uuid', LIMIT, WINDOW);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(2);
  });

  test('namespaces its keys so it shares Redis with sessions and queues safely', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([1, 9, 0]) };
    await createRedisRateLimitStore(redis).consume('word-request:uuid', LIMIT, WINDOW);

    expect(redis.eval.mock.calls[0][2]).toBe('ratelimit:word-request:uuid');
  });

  test('fails OPEN when Redis is unavailable', async () => {
    // NFR-SEC-11 states the counters are ephemeral and that losing them at most
    // resets limits, so an outage must not take the form down with it. The edge
    // WAF limit of Appendix C still applies underneath.
    const redis = { eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

    const decision = await createRedisRateLimitStore(redis).consume(
      'word-request:uuid',
      LIMIT,
      WINDOW,
    );

    expect(decision.allowed).toBe(true);
  });
});
