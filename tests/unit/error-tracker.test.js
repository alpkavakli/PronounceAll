/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * What the error tracker may send (NFR-OPS-03, NFR-SEC-10, NFR-PRIV-06) and
 * when the middleware reports (SDD v1.1 §6.1).
 */

import { EventEmitter } from 'node:events';

import { describe, expect, test } from '@jest/globals';

import { AppError } from '../../src/errors/index.js';
import { disabledErrorTracker, scrubEvent, scrubPath, scrubText } from '../../src/lib/error-tracker.js';
import { errorHandler, serverErrorReporting } from '../../src/middleware/error-handler.js';

describe('scrubbing', () => {
  test.each([
    ['an email address', 'no account for Person.Name+tag@example.co.uk here', 'no account for [email] here'],
    ['a token', 'session 3q2-7Hk_9xY0aBcDeFgHiJkLmNoPqRsTuV expired', 'session [redacted] expired'],
    ['a UUID', 'profile 1b4e28ba-2fa1-41d2-883f-0016d3cca427 missing', 'profile [redacted] missing'],
    ['an IPv4 address', 'connect ECONNREFUSED 10.0.12.7:3306', 'connect ECONNREFUSED [ip]:3306'],
    ['an IPv6 address', 'from 2001:db8:85a3:0:0:8a2e:370:7334 refused', 'from [ip] refused'],
  ])('masks %s', (_label, input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  test('keeps an ordinary diagnostic message intact', () => {
    expect(scrubText("Cannot read properties of undefined (reading 'wordId')")).toBe("Cannot read properties of undefined (reading 'wordId')");
  });

  test('a path loses its query string and fragment', () => {
    expect(scrubPath('/verify-email?token=abcdefghijklmnopqrstuvwxyz012345#x')).toBe('/verify-email');
    expect(scrubPath('/en-us/cupcake')).toBe('/en-us/cupcake');
  });

  test('an event keeps its diagnostic shape and loses everything personal', () => {
    const event = scrubEvent({
      message: 'failed for someone@example.com',
      request: { method: 'POST', url: '/login?next=/x', headers: { cookie: 'pa_sid=secret' }, data: 'password=hunter2', cookies: { pa_sid: 'x' } },
      user: { ip_address: '203.0.113.9', email: 'someone@example.com' },
      breadcrumbs: [{ message: 'GET /reset-password/confirm?token=abc' }],
      extra: { body: 'password=hunter2' },
      server_name: 'prod-host-1',
      exception: { values: [{ type: 'Error', value: 'dup entry someone@example.com', stacktrace: { frames: [{ function: 'f', vars: { password: 'x' } }] } }] },
    });
    expect(event.request).toEqual({ method: 'POST', url: '/login' });
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.message).toBe('failed for [email]');
    expect(event.exception.values[0]).toEqual({ type: 'Error', value: 'dup entry [email]', stacktrace: { frames: [{ function: 'f' }] } });
    expect(JSON.stringify(event)).not.toMatch(/hunter2|secret|someone@|203\.0\.113/);
  });

  test('with no DSN the tracker does nothing', async () => {
    expect(disabledErrorTracker.enabled).toBe(false);
    expect(() => disabledErrorTracker.reportError(new Error('x'), {})).not.toThrow();
    expect(await disabledErrorTracker.flush()).toBe(true);
  });
});

describe('when the middleware reports', () => {
  function fakeResponse() {
    const res = new EventEmitter();
    Object.assign(res, {
      locals: { correlationId: 'c0ffee', errorSurface: 'json' },
      headersSent: false,
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader() {},
      json() {},
      render() {},
    });
    return res;
  }
  const req = { method: 'GET', originalUrl: '/settings?token=abc', query: {} };

  test('a 5xx is reported once, with the original cause, the correlation id and the path without its query', () => {
    const reports = [];
    const res = fakeResponse();
    const cause = new Error('boom');
    errorHandler({ reportError: (error, context) => reports.push({ error, context }) })(cause, req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(reports).toHaveLength(1);
    expect(reports[0].error).toBe(cause);
    expect(reports[0].context).toEqual({ correlationId: 'c0ffee', code: 'INTERNAL', method: 'GET', path: '/settings' });
    expect(res.locals.errorReported).toBe(true);
  });

  test('a 4xx is not reported', () => {
    const reports = [];
    errorHandler({ reportError: () => reports.push(1) })(AppError.validation('no'), req, fakeResponse(), () => {});
    errorHandler({ reportError: () => reports.push(1) })(AppError.notFound(), req, fakeResponse(), () => {});
    expect(reports).toHaveLength(0);
  });

  test('any other 5xx response is reported by status; one already reported is not reported twice', () => {
    const reports = [];
    const middleware = serverErrorReporting({ reportResponse: (context) => reports.push(context) });
    for (const [status, alreadyReported] of [[503, false], [500, true], [404, false], [200, false]]) {
      const res = fakeResponse();
      middleware(req, res, () => {});
      res.statusCode = status;
      res.locals.errorReported = alreadyReported;
      res.emit('finish');
    }
    expect(reports).toEqual([{ status: 503, method: 'GET', path: '/settings', correlationId: 'c0ffee' }]);
  });
});
