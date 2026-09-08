/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * FR-AUTH-01 acceptance criteria, exercised through the real middleware
 * pipeline over a minimal route set, so the assertions are about the cookie
 * rule rather than about any one feature route.
 */

import { describe, expect, test } from '@jest/globals';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';

import {
  anonymousIdentityMiddleware,
  markCacheableShell,
  markHydration,
  responseClassMiddleware,
} from '../../src/middleware/index.js';
import { isValidAnonymousId } from '../../src/lib/ids.js';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function buildApp() {
  const app = express();
  app.use(responseClassMiddleware());
  app.use(cookieParser());
  app.use(anonymousIdentityMiddleware());

  // Stands in for the uncached hydration endpoint of B2.
  app.get('/hydrate', (req, res) => {
    markHydration(res);
    res.json({ anonymousId: req.anonymousId });
  });

  // Stands in for the shared, edge-cached word-page shell of B2.
  app.get('/shell', (req, res) => {
    markCacheableShell(res);
    res.type('html').send('<p>shell</p>');
  });

  // Any other uncached origin-reaching response.
  app.post('/write', (req, res) => res.json({ anonymousId: req.ensureAnonymousId() }));

  return app;
}

/** @param {import('supertest').Response} res @returns {string | undefined} */
function paUidCookie(res) {
  return [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith('pa_uid='));
}

describe('pa_uid issuance (FR-AUTH-01)', () => {
  test('the first uncached origin-reaching response issues the cookie', async () => {
    const res = await request(buildApp()).get('/hydrate');
    const cookie = paUidCookie(res);

    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Max-Age=63072000/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  test('the issued value is a valid v4 UUID', async () => {
    const res = await request(buildApp()).get('/hydrate');
    const value = paUidCookie(res).split(';')[0].slice('pa_uid='.length);

    expect(isValidAnonymousId(value)).toBe(true);
    expect(res.body.anonymousId).toBeNull(); // no row, no identity, until needed
  });

  test('the cacheable shell carries no Set-Cookie for pa_uid', async () => {
    const res = await request(buildApp()).get('/shell');

    expect(paUidCookie(res)).toBeUndefined();
    expect(res.headers['cache-control']).toMatch(/^public, max-age=0, s-maxage=/);
  });

  test('the shell carries none even for a viewer that already has one', async () => {
    const res = await request(buildApp()).get('/shell').set('Cookie', `pa_uid=${UUID}`);
    expect(paUidCookie(res)).toBeUndefined();
  });

  test('a subsequent uncached response refreshes Max-Age on the same value', async () => {
    const res = await request(buildApp()).get('/hydrate').set('Cookie', `pa_uid=${UUID}`);

    expect(paUidCookie(res)).toContain(`pa_uid=${UUID}`);
    expect(paUidCookie(res)).toMatch(/Max-Age=63072000/);
    expect(res.body.anonymousId).toBe(UUID);
  });

  test('a malformed cookie value is replaced rather than trusted', async () => {
    const res = await request(buildApp())
      .get('/hydrate')
      .set('Cookie', "pa_uid=' OR 1=1 --");
    const value = paUidCookie(res).split(';')[0].slice('pa_uid='.length);

    expect(isValidAnonymousId(value)).toBe(true);
    expect(value).not.toContain('OR 1=1');
    expect(res.body.anonymousId).toBeNull();
  });

  test('a write path receives a stable identity that matches the cookie set', async () => {
    const res = await request(buildApp()).post('/write');
    const value = paUidCookie(res).split(';')[0].slice('pa_uid='.length);

    expect(res.body.anonymousId).toBe(value);
  });

  test('the hydration response is never cached or shared', async () => {
    const res = await request(buildApp()).get('/hydrate');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});
