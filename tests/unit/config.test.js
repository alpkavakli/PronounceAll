/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

import { describe, expect, test } from '@jest/globals';

import { loadConfig } from '../../src/config/index.js';

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  APP_BASE_URL: 'https://pronounceall.com',
  MYSQL_HOST: 'db.internal',
  MYSQL_DATABASE: 'pronounceall',
  MYSQL_USER: 'pronounceall_app',
  MYSQL_PASSWORD: 'supplied-at-deploy-time',
  REDIS_URL: 'redis://cache.internal:6379',
};

describe('loadConfig (SDD v1.1 §6.4, NFR-SEC-06)', () => {
  test('development boots on defaults alone', () => {
    const config = loadConfig({});
    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.isProductionLike).toBe(false);
  });

  test('production fails fast when a required variable is absent', () => {
    const { MYSQL_PASSWORD, ...incomplete } = PRODUCTION_ENV;
    expect(() => loadConfig(incomplete)).toThrow(/MYSQL_PASSWORD/);
  });

  test('production fails fast when a required variable is empty', () => {
    expect(() => loadConfig({ ...PRODUCTION_ENV, MYSQL_USER: '' })).toThrow(/MYSQL_USER/);
  });

  test('production boots when every required variable is supplied', () => {
    const config = loadConfig(PRODUCTION_ENV);
    expect(config.isProductionLike).toBe(true);
    expect(config.mysql.host).toBe('db.internal');
  });

  test('rejects a malformed value rather than coercing it', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
    expect(() => loadConfig({ APP_BASE_URL: 'not-a-url' })).toThrow(/APP_BASE_URL/);
    expect(() => loadConfig({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });

  test('the returned configuration is frozen', () => {
    const config = loadConfig({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.mysql)).toBe(true);
  });
});

describe('anonymous cookie attributes (FR-AUTH-01, SRS Appendix D)', () => {
  test('matches the requirement in a production-like environment', () => {
    expect(loadConfig(PRODUCTION_ENV).anonymousCookie).toEqual({
      name: 'pa_uid',
      maxAgeSeconds: 63072000,
      httpOnly: false, // the FR-AUTH-02 localStorage mirror needs JS access
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  test('relaxes Secure only outside production-like environments', () => {
    expect(loadConfig({}).anonymousCookie.secure).toBe(false);
    expect(loadConfig({ ...PRODUCTION_ENV, NODE_ENV: 'staging' }).anonymousCookie.secure).toBe(
      true,
    );
  });
});
