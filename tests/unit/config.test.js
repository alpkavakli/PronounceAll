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
  // FR-WORD-05 gates the word-request form behind Turnstile, so a
  // production-like boot requires both keys (Iteration 1).
  TURNSTILE_SITE_KEY: 'supplied-at-deploy-time',
  TURNSTILE_SECRET_KEY: 'supplied-at-deploy-time',
  CSRF_SECRET: 'supplied-at-deploy-time-and-at-least-32-chars',
  SMTP_HOST: 'smtp.relay.example',
  SMTP_USER: 'supplied-at-deploy-time',
  SMTP_PASSWORD: 'supplied-at-deploy-time',
  MAIL_FROM: 'PronounceAll <no-reply@pronounceall.com>',
  GOOGLE_CLIENT_ID: 'supplied-at-deploy-time.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'supplied-at-deploy-time',
  PRIVACY_POLICY_VERSION: '1.0',
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

  test('production requires the Turnstile keys (FR-WORD-05)', () => {
    // A deployment without the secret cannot verify a token, so the abuse gate
    // the requirement mandates would exist in name only.
    const { TURNSTILE_SECRET_KEY, ...incomplete } = PRODUCTION_ENV;
    expect(() => loadConfig(incomplete)).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  test.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'])(
    'production refuses to boot without %s — the Mailpit defaults are development-only',
    (name) => {
      const { [name]: omitted, ...incomplete } = PRODUCTION_ENV;
      expect(() => loadConfig(incomplete)).toThrow(name);
    },
  );

  test.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])(
    'production refuses to boot without %s — no fake Google credentials',
    (name) => {
      const { [name]: omitted, ...incomplete } = PRODUCTION_ENV;
      expect(() => loadConfig(incomplete)).toThrow(name);
    },
  );

  test('the Google redirect URI defaults to the public origin, and is not offered unconfigured', () => {
    const local = loadConfig({ NODE_ENV: 'development', APP_BASE_URL: 'http://localhost:3000' });
    expect(local.google).toMatchObject({ isConfigured: false, redirectUri: 'http://localhost:3000/auth/google/callback' });
    expect(loadConfig(PRODUCTION_ENV).google.isConfigured).toBe(true);
  });

  test('production refuses to boot without PRIVACY_POLICY_VERSION; locally it says "unpublished-draft"', () => {
    const { PRIVACY_POLICY_VERSION, ...incomplete } = PRODUCTION_ENV;
    expect(() => loadConfig(incomplete)).toThrow('PRIVACY_POLICY_VERSION');
    expect(loadConfig({ NODE_ENV: 'development' }).privacyPolicyVersion).toBe('unpublished-draft');
  });

  test('development defaults to the local Mailpit catcher', () => {
    const { mail } = loadConfig({ NODE_ENV: 'development' });
    expect(mail).toMatchObject({ host: '127.0.0.1', port: 1025, secure: false });
  });

  test('in-memory rate limiting is refused outside development (NFR-SEC-11)', () => {
    expect(() => loadConfig({ ...PRODUCTION_ENV, RATE_LIMIT_STORE: 'memory' })).toThrow(
      /RATE_LIMIT_STORE/,
    );
    expect(() => loadConfig({ ...PRODUCTION_ENV, NODE_ENV: 'staging', RATE_LIMIT_STORE: 'memory' }))
      .toThrow(/RATE_LIMIT_STORE/);
    // Permitted locally, which is exactly what NFR-SEC-11 allows.
    expect(loadConfig({ RATE_LIMIT_STORE: 'memory' }).rateLimitStore).toBe('memory');
  });

  test('Turnstile and cache purge report themselves unconfigured when keys are absent', () => {
    const config = loadConfig({});
    expect(config.turnstile.isConfigured).toBe(false);
    expect(config.cloudflareCachePurge.isConfigured).toBe(false);
    // Both halves are needed: a site key with no secret behind it would render
    // a challenge that nothing verifies.
    expect(loadConfig({ TURNSTILE_SITE_KEY: 'only-the-public-half' }).turnstile.isConfigured).toBe(
      false,
    );
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
