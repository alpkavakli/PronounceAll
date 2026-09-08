/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The two error surfaces of SDD v1.1 §6.1 / C2: an EJS view for HTML page
 * routes, a JSON object for JSON routes, selected by the route group rather
 * than by the client's `Accept` header.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { AppError } from '../../src/errors/index.js';
import {
  errorHandler,
  jsonErrorSurface,
  notFoundHandler,
  requestContextMiddleware,
  responseClassMiddleware,
} from '../../src/middleware/index.js';

const viewsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'views',
);

const LEAKY_CAUSE = new Error('SELECT password_hash FROM user_accounts failed at db.internal:3306');

function buildApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', viewsDir);
  app.use(requestContextMiddleware());
  app.use(responseClassMiddleware());

  // Route-level, not router-level: a prefix-less router's `use` would mark
  // every request as JSON, including the HTML page route below.
  app.get('/api/boom', jsonErrorSurface(), () => {
    throw LEAKY_CAUSE;
  });
  app.get('/api/limited', jsonErrorSurface(), () => {
    throw AppError.rateLimit(90);
  });
  app.get('/api/auth', jsonErrorSurface(), () => {
    throw AppError.auth({ cause: new Error('no such user: ada@example.com') });
  });

  app.get('/page/boom', () => {
    throw LEAKY_CAUSE;
  });

  app.use(notFoundHandler());
  app.use(errorHandler());
  return app;
}

describe('JSON error surface', () => {
  test('returns the safe message, stable code, and correlation id only', async () => {
    const res = await request(buildApp()).get('/api/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.correlationId).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'message']);
  });

  test('never serialises the underlying cause or a stack', async () => {
    const res = await request(buildApp()).get('/api/boom');
    const body = JSON.stringify(res.body);

    expect(body).not.toMatch(/password_hash|db\.internal|SELECT/);
    expect(body).not.toMatch(/at Object|\.js:\d+/);
  });

  test('an auth failure reveals nothing about which factor failed', async () => {
    const res = await request(buildApp()).get('/api/auth');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials.');
    expect(JSON.stringify(res.body)).not.toMatch(/ada@example\.com|no such user/);
  });

  test('a rate limit writes Retry-After to the header from metadata', async () => {
    const res = await request(buildApp()).get('/api/limited');

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('90');
  });
});

describe('HTML error surface', () => {
  test('renders the error view rather than a JSON body', async () => {
    const res = await request(buildApp()).get('/page/boom');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/Something went wrong on our end/);
  });

  test('leaks neither the cause nor a stack into the page', async () => {
    const res = await request(buildApp()).get('/page/boom');

    expect(res.text).not.toMatch(/password_hash|db\.internal|SELECT/);
    expect(res.text).not.toMatch(/\.js:\d+/);
  });

  test('the surface is the route group, not the Accept header', async () => {
    const asJson = await request(buildApp()).get('/page/boom').set('Accept', 'application/json');
    expect(asJson.headers['content-type']).toMatch(/text\/html/);

    const asHtml = await request(buildApp()).get('/api/boom').set('Accept', 'text/html');
    expect(asHtml.headers['content-type']).toMatch(/application\/json/);
  });

  test('the error view carries no inline script or style (NFR-SEC-03)', async () => {
    const res = await request(buildApp()).get('/page/boom');

    expect(res.text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
    expect(res.text).not.toMatch(/<style[^>]*>/);
  });
});

describe('unmatched routes', () => {
  test('travel the same taxonomy as any other failure', async () => {
    const res = await request(buildApp()).get('/no/such/path');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/could not be found/);
  });
});
