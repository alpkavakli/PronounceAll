/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Error tracking end to end, Iteration 7 slice 3 (NFR-OPS-03, NFR-SEC-10,
 * NFR-PRIV-06; SDD v1.1 §6.1, §6.2; Threat Model F5).
 *
 * A real Sentry client whose transport captures the envelopes instead of
 * sending them, behind the real middleware. The assertions are on the bytes
 * that would leave the server: the diagnostics are there, the person is not.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import * as Sentry from '@sentry/node';
import express from 'express';
import request from 'supertest';

const { createErrorTracker } = await import('../../src/lib/error-tracker.js');
const { errorHandler, jsonErrorSurface, requestContextMiddleware, serverErrorReporting } = await import('../../src/middleware/index.js');

const sent = [];
let tracker;
let app;

const PASSWORD = 'correct-horse-battery-staple';
const EMAIL = 'learner.person@example.com';
const TOKEN = 'Zk3V8qY2pL0wXnR5tB7cD9eF1gH4jK6m';
const COOKIE = 'pa_sid=s3ss10nVal0e-that-must-never-leave-the-server';

beforeAll(() => {
  tracker = createErrorTracker({
    dsn: 'https://publickey@o0.ingest.de.sentry.io/1',
    environment: 'test',
    component: 'web',
    transport: (options) =>
      Sentry.createTransport(options, async (outgoing) => {
        sent.push(typeof outgoing.body === 'string' ? outgoing.body : Buffer.from(outgoing.body).toString('utf8'));
        return { statusCode: 200 };
      }),
  });

  app = express();
  app.use(requestContextMiddleware());
  app.use(serverErrorReporting(tracker));
  app.use(express.urlencoded({ extended: false }));
  app.post('/explode', jsonErrorSurface(), () => {
    throw new Error(`insert failed for ${EMAIL} with token ${TOKEN}`);
  });
  app.get('/unavailable', (req, res) => res.status(503).send('try again'));
  app.get('/missing', jsonErrorSurface(), (req, res, next) => next(Object.assign(new Error('nope'), { status: 404 })));
  app.use(errorHandler({ reportError: tracker.reportError }));
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await Sentry.close(1000);
});

async function settle() {
  await tracker.flush(2000);
  return sent.join('\n');
}

describe('NFR-OPS-03 — what reaches the tracker', () => {
  test('an unhandled error: type, scrubbed message, stack, correlation id, method and bare path — and nothing personal', async () => {
    const response = await request(app)
      .post(`/explode?reset=${TOKEN}&email=${encodeURIComponent(EMAIL)}`)
      .set('Cookie', COOKIE)
      .set('User-Agent', 'TestBrowser/1.0')
      .set('X-Forwarded-For', '198.51.100.23')
      .type('form')
      .send(`password=${PASSWORD}&email=${encodeURIComponent(EMAIL)}`);
    expect(response.status).toBe(500);
    const { correlationId } = response.body.error;

    const envelope = await settle();
    expect(envelope).toContain('"type":"Error"');
    expect(envelope).toContain('insert failed for [email] with token [redacted]');
    expect(envelope).toContain(`"correlation_id":"${correlationId}"`);
    expect(envelope).toContain('"url":"/explode"');
    expect(envelope).toContain('"method":"POST"');
    expect(envelope).toContain('"component":"web"');
    expect(envelope).toContain('"frames"');

    for (const secret of [PASSWORD, EMAIL, TOKEN, 's3ss10nVal0e', 'TestBrowser', '198.51.100.23', 'reset=', encodeURIComponent(EMAIL)]) {
      expect(envelope).not.toContain(secret);
    }
  });

  test('a 5xx a route renders itself is reported by status and path', async () => {
    expect((await request(app).get('/unavailable?token=x').set('Cookie', COOKIE)).status).toBe(503);
    const envelope = await settle();
    expect(envelope).toContain('HTTP 503 response');
    expect(envelope).toContain('"status":"503"');
    expect(envelope).toContain('"url":"/unavailable"');
    expect(envelope).not.toContain('s3ss10nVal0e');
  });

  test('a client error is not reported', async () => {
    expect((await request(app).get('/missing')).status).toBe(400);
    expect(await settle()).toBe('');
  });
});
