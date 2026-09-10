/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word-request capture (FR-WORD-05, Foundational Decisions §10.3, Appendix C).
 *
 * The invariants, not the happy path: the duplicate up-vote must be ONE row
 * rather than two, the rate-limit boundary must be exact and carry
 * `Retry-After`, a missing Turnstile token must be refused before any write,
 * and the row must hold no personal data beyond the anonymous UUID.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';

// NFR-SEC-11 permits in-memory counters outside staging and production. Here it
// also makes the boundary test deterministic and independent of Redis: an
// in-memory counter starts empty in every process, so the suite is repeatable,
// whereas a Redis counter would still hold the previous run's hits under the
// one-hour window of Appendix C.
//
// This assignment MUST precede the application import, and the import below is
// therefore dynamic. A static `import` is hoisted and evaluated before any
// statement in the module body, so `src/config/index.js` would read the
// environment BEFORE this line ran and freeze the real store — silently, since
// the suite would still pass on a clean Redis and only fail on the second run
// within the hour.
process.env.RATE_LIMIT_STORE = 'memory';

const { createApp } = await import('../../src/app.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { closeRedis } = await import('../../src/lib/redis.js');

const app = createApp();

/**
 * A distinct UUID per test, so one test cannot exhaust another's budget.
 *
 * The counter is namespaced by a per-RUN random block as well. Rate-limit
 * counters outlive the rows this suite cleans up — Appendix C's window is an
 * hour — so a fixture identity reused by a later run would start part-way
 * through its budget and the boundary assertions would fail on the second run.
 * Both halves stay a syntactically valid v4 UUID, which `isValidAnonymousId`
 * requires: version nibble `4`, variant nibble `8`.
 */
const RUN = randomUUID().slice(0, 8);
let uuidCounter = 0;
function nextUuid() {
  uuidCounter += 1;
  return `${RUN}-bbbb-4ccc-8ddd-${String(uuidCounter).padStart(12, '0')}`;
}

/** Fixture words are prefixed so cleanup cannot touch real requests. */
const PREFIX = 'zzreq';

/**
 * @param {object} options
 * @returns {import('supertest').Test}
 */
function submit({ word, uuid = nextUuid(), token = 'a-token', variant = 'en-us' }) {
  const body = new URLSearchParams({ variant, word });
  if (typeof token === 'string') {
    body.set('cf-turnstile-response', token);
  }
  return request(app)
    .post('/request-word')
    .set('Cookie', [`pa_uid=${uuid}`])
    .type('form')
    .send(body.toString());
}

/** @param {string} word @returns {Promise<object | null>} */
async function readRequest(word) {
  const [rows] = await getPool().execute(
    `SELECT normalized_word, upvote_count, status, submitted_by_user_id,
            submitted_by_anonymous_id
       FROM word_requests
      WHERE normalized_word = ?`,
    [word],
  );
  return rows[0] ?? null;
}

afterEach(async () => {
  await getPool().execute('DELETE FROM word_requests WHERE normalized_word LIKE ?', [`${PREFIX}%`]);
});

afterAll(async () => {
  await closePool();
  await closeRedis();
});

describe('FR-WORD-05 — recording a request', () => {
  test('a submission creates one row and redirects', async () => {
    const word = `${PREFIX}alpha`;
    const response = await submit({ word });

    // POST-redirect-GET, so a refresh cannot resubmit and the acknowledgement
    // survives without JavaScript.
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(`/en-us/${word}?requested=new`);

    const row = await readRequest(word);
    expect(row).toMatchObject({ normalized_word: word, upvote_count: 1, status: 'open' });
  });

  test('the row holds the anonymous UUID and NO other identifying data', async () => {
    const word = `${PREFIX}bravo`;
    const uuid = nextUuid();
    await submit({ word, uuid });

    const row = await readRequest(word);
    expect(row.submitted_by_anonymous_id).toBe(uuid);
    // There is no `users` table in Iteration 1, and the column is staged
    // nullable without its foreign key.
    expect(row.submitted_by_user_id).toBeNull();
  });

  test('a duplicate UP-VOTES one row rather than inserting a second', async () => {
    const word = `${PREFIX}charlie`;

    await submit({ word });
    const second = await submit({ word });

    expect(second.headers.location).toBe(`/en-us/${word}?requested=upvoted`);

    const [rows] = await getPool().execute(
      'SELECT upvote_count FROM word_requests WHERE normalized_word = ?',
      [word],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].upvote_count).toBe(2);
  });

  test('concurrent first submissions of the same word yield ONE row', async () => {
    // Two requests racing on a word neither has seen. A read-then-write would
    // let both see "absent" and one would die on the unique key; the upsert
    // turns the loser into an up-vote.
    const word = `${PREFIX}delta`;

    await Promise.all([submit({ word }), submit({ word }), submit({ word })]);

    const [rows] = await getPool().execute(
      'SELECT upvote_count FROM word_requests WHERE normalized_word = ?',
      [word],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].upvote_count).toBe(3);
  });

  test('a word already in the dictionary is not recorded as a request', async () => {
    const response = await submit({ word: 'cupcake' });

    expect(response.status).toBe(303);
    // No query string: landing on the word IS the acknowledgement, and the
    // canonical URL keeps one edge-cache entry rather than two.
    expect(response.headers.location).toBe('/en-us/cupcake');
    expect(await readRequest('cupcake')).toBeNull();
  });

  test('the slug is normalised the same way the word page normalises it', async () => {
    const word = `${PREFIX}echo`;
    await submit({ word: `  ${PREFIX}ECHO  ` });

    expect(await readRequest(word)).not.toBeNull();
  });
});

describe('FR-WORD-05 — the Turnstile gate', () => {
  test('a submission with no token at all is rejected with 400', async () => {
    const word = `${PREFIX}foxtrot`;
    const response = await submit({ word, token: null });

    expect(response.status).toBe(400);
    // Rejected BEFORE any write, so a refused submission leaves no row.
    expect(await readRequest(word)).toBeNull();
  });

  test('a submission with an empty token is rejected with 400', async () => {
    const word = `${PREFIX}golf`;
    const response = await submit({ word, token: '' });

    expect(response.status).toBe(400);
    expect(await readRequest(word)).toBeNull();
  });
});

describe('FR-WORD-05 — input validation', () => {
  test('a slug outside the allow-list is refused and stored nowhere', async () => {
    const response = await submit({ word: `${PREFIX}bad word` });

    expect(response.status).toBe(400);
    expect(await readRequest(`${PREFIX}bad word`)).toBeNull();
  });

  test('an unsupported variant is a 404', async () => {
    expect((await submit({ word: `${PREFIX}hotel`, variant: 'fr-fr' })).status).toBe(404);
  });

  test('a missing field is a 400', async () => {
    const response = await request(app)
      .post('/request-word')
      .set('Cookie', [`pa_uid=${nextUuid()}`])
      .type('form')
      .send('variant=en-us&cf-turnstile-response=a-token');

    expect(response.status).toBe(400);
  });
});

describe('Appendix C — the rate limit', () => {
  test('admits exactly ten per hour per UUID, then 429s with Retry-After', async () => {
    const uuid = nextUuid();

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await submit({ word: `${PREFIX}limit${'a'.repeat(attempt)}`, uuid });
      expect(response.status).toBe(303);
    }

    // The 11th submission within the rolling hour.
    const denied = await submit({ word: `${PREFIX}limitoverflow`, uuid });

    expect(denied.status).toBe(429);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(denied.headers['retry-after'])).toBeLessThanOrEqual(3600);
    expect(await readRequest(`${PREFIX}limitoverflow`)).toBeNull();
  });

  test('the limit is per UUID, so one visitor cannot lock out another', async () => {
    const exhausted = nextUuid();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await submit({ word: `${PREFIX}other${'b'.repeat(attempt)}`, uuid: exhausted });
    }
    expect((await submit({ word: `${PREFIX}otherlast`, uuid: exhausted })).status).toBe(429);

    expect((await submit({ word: `${PREFIX}freshvisitor`, uuid: nextUuid() })).status).toBe(303);
  });

  test('a rejected submission still consumes budget', async () => {
    // Otherwise the limit is trivially bypassed by sending invalid submissions.
    const uuid = nextUuid();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await submit({ word: `${PREFIX}spend${'c'.repeat(attempt)}`, uuid, token: null });
    }

    expect((await submit({ word: `${PREFIX}spendlast`, uuid })).status).toBe(429);
  });
});
