/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The word search route (FIND-10).
 *
 * Implemented ahead of the specification, so these tests are currently the only
 * written statement of the endpoint's contract. They are deliberately explicit
 * about the branches — exact, near, none, empty, bad variant — because the
 * eventual `FR-WORD-11` acceptance criteria should be able to be read off them.
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

describe('an exact match goes straight to the word', () => {
  test('redirects rather than rendering a list of one', async () => {
    const response = await request(app).get('/search').query({ q: 'cupcake' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/en-us/cupcake');
  });

  test('finds the word through lenient normalisation', async () => {
    // Every one of these is a 400 on the word route and a hit here.
    for (const q of ['Cupcake', '  cupcake  ', 'Cup Cake', 'CUP CAKE!']) {
      const response = await request(app).get('/search').query({ q });
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/en-us/cupcake');
    }
  });

  test('a word with an apostrophe survives the round trip', async () => {
    const response = await request(app).get('/search').query({ q: "Don't" });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`/en-us/${encodeURIComponent("don't")}`);
  });

  test('the redirect is temporary, not permanent', async () => {
    // A query-to-word mapping is not permanent, and a cached 301 on /search
    // would be a nuisance to undo once the dictionary grows.
    const response = await request(app).get('/search').query({ q: 'cupcake' });
    expect(response.status).not.toBe(301);
  });
});

describe('a near match offers the E3 ranking', () => {
  test('cuppcake suggests cupcake', async () => {
    const response = await request(app).get('/search').query({ q: 'cuppcake' });

    expect(response.status).toBe(200);
    expect(response.text).toContain('/en-us/cupcake');
  });

  test('a transposition is recovered — the same matcher as the 404 path', async () => {
    const response = await request(app).get('/search').query({ q: 'freind' });

    expect(response.status).toBe(200);
    expect(response.text).toContain('/en-us/friend');
  });

  test('never offers more than five suggestions', async () => {
    const response = await request(app).get('/search').query({ q: 'wor' });
    const links = response.text.match(/class="suggestion__link"/g) ?? [];

    expect(links.length).toBeLessThanOrEqual(5);
  });
});

describe('no match offers the word-request path instead', () => {
  test('points at the 404 page, which carries the request form', async () => {
    // A slug that stays unmatchable as the dictionary grows; FIND-11 records
    // why `xqzzy` no longer is.
    const response = await request(app).get('/search').query({ q: 'qxzjvwkmpf' });

    expect(response.status).toBe(200);
    // The link goes to the word's own 404, which is where FR-WORD-05's request
    // form lives — search does not grow a second copy of it.
    expect(response.text).toContain('/en-us/qxzjvwkmpf');
    expect(response.text).toMatch(/no word close to/i);
    expect(response.text).toMatch(/request/i);
    expect(response.text).not.toContain('class="suggestion__link"');
  });
});

describe('an empty query prompts rather than erroring', () => {
  test.each([
    ['an empty parameter', { q: '' }],
    ['no parameter at all', {}],
    ['only punctuation', { q: '!!!' }],
  ])('%s renders the form with a hint', async (_label, query) => {
    const response = await request(app).get('/search').query(query);

    expect(response.status).toBe(200);
    expect(response.text).toContain('action="/search"');
  });
});

describe('the variant is validated before anything is looked up', () => {
  test('an unsupported variant is a 404, not a fall back to en-us', async () => {
    const response = await request(app)
      .get('/search')
      .query({ q: 'cupcake', variant: 'fr-fr' });

    expect(response.status).toBe(404);
  });

  test('an absent variant uses the v1.0 default', async () => {
    const response = await request(app).get('/search').query({ q: 'cupcake' });
    expect(response.headers.location).toBe('/en-us/cupcake');
  });
});

describe('the response is a plain, uncached page', () => {
  test('results are private and not edge-cached', async () => {
    const response = await request(app).get('/search').query({ q: 'cuppcake' });

    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  test('carries no inline script or style', async () => {
    const response = await request(app).get('/search').query({ q: 'cuppcake' });

    expect(response.text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
    expect(response.text).not.toMatch(/<style[^>]*>/);
  });

  test('the query is escaped into the page, not injected', async () => {
    const response = await request(app)
      .get('/search')
      .query({ q: '<img src=x onerror=alert(1)>' });

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('<img src=x');
  });
});

describe('the home page offers the way in', () => {
  test('renders the search form', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('action="/search"');
    expect(response.text).toContain('name="q"');
  });
});
