/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Configuration loading and validation (SDD v1.1 §6.4, NFR-SEC-06, C4).
 *
 * This is the only module in the application permitted to read `process.env`.
 * The environment is read and validated exactly once at startup; in staging and
 * production a missing or malformed required variable is a fatal boot error, so
 * a misconfiguration surfaces at boot rather than at first use. Business
 * services never read the environment: they receive the values they need as
 * arguments or through the composition root.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';
import 'dotenv/config';

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

/** Environments where a missing or malformed variable must fail the boot. */
const STRICT_ENVIRONMENTS = new Set(['staging', 'production']);

const port = z.coerce.number().int().min(1).max(65535);

const schema = z.object({
  NODE_ENV: z.enum(ENVIRONMENTS).default('development'),
  PORT: port.default(3000),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('debug'),

  MYSQL_HOST: z.string().min(1).default('127.0.0.1'),
  MYSQL_PORT: port.default(3306),
  MYSQL_DATABASE: z.string().min(1).default('pronounceall'),
  MYSQL_USER: z.string().min(1).default('pronounceall_app'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  /**
   * Rate-limit counter store (NFR-SEC-11). Redis in staging and production;
   * `memory` is permitted for local development only and is rejected below in a
   * strict environment, so the restriction is enforced rather than documented.
   */
  RATE_LIMIT_STORE: z.enum(['redis', 'memory']).default('redis'),

  /**
   * Audio asset storage (V4, FR-CONTENT-04). Pre-generated audio lives on local
   * disk with content-addressed immutable filenames; in production Nginx serves
   * the directory directly and Express never sees the request.
   */
  AUDIO_STORAGE_ROOT: z.string().min(1).default('data/audio'),
  AUDIO_PUBLIC_PREFIX: z.string().min(1).default('/audio'),

  // Cloudflare Turnstile, gating the word-request form (FR-WORD-05).
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_SECRET_KEY: z.string().default(''),

  // Cloudflare cache purge on re-seed (SDD v1.1 §6.3). Optional: Iteration 1
  // builds the adapter seam and the credentials follow with the production-edge
  // work. An unconfigured seam purges nothing and says so; it never pretends.
  CLOUDFLARE_ZONE_ID: z.string().default(''),

  /**
   * HMAC key for the stateless CSRF token (FR-AUTH-20, SDD v1.1 §6.6). Required
   * and at least 32 characters in staging and production. Locally an unset
   * value is replaced by a per-process random key, so tokens simply stop
   * verifying after a restart.
   */
  CSRF_SECRET: z.string().default(''),
  CLOUDFLARE_CACHE_PURGE_TOKEN: z.string().default(''),

  /**
   * Outgoing transactional email over SMTP (FR-AUTH-09/11). The defaults point
   * at the development-only Mailpit catcher in docker-compose. Staging and
   * production must name a real relay with credentials; the provider itself is
   * not fixed in code (V5 is provisional).
   */
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: port.default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().min(3).default('PronounceAll <no-reply@pronounceall.localhost>'),

  /**
   * Google sign-in (FR-AUTH-04a, FR-AUTH-16). A confidential OAuth client: the
   * secret stays on the server. Empty locally means the Google path is simply
   * not offered; staging and production refuse to boot without the pair. The
   * redirect URI must match the one registered with Google exactly; it
   * defaults to APP_BASE_URL + /auth/google/callback.
   */
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default(''),

  /**
   * The privacy-policy version an ads opt-in is recorded against (FR-CONSENT-03,
   * GDPR Art. 7). Set it to the published policy's version; locally it defaults
   * to a value that says plainly no policy has been published.
   */
  PRIVACY_POLICY_VERSION: z.string().min(1).max(32).default('unpublished-draft'),
});

/**
 * Variables that carry no usable default and must be supplied explicitly once
 * the deployment is a real one. Kept as a list rather than a schema branch so
 * the strict-environment rule reads in one place.
 */
const REQUIRED_IN_STRICT_ENVIRONMENTS = [
  'APP_BASE_URL',
  'MYSQL_HOST',
  'MYSQL_DATABASE',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'REDIS_URL',
  // FR-WORD-05 gates the word-request form behind Turnstile. A real deployment
  // must therefore hold real keys: without the secret the verifier cannot
  // verify anything, and the gate would exist in name only.
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  // SDD §6.6: a fixed secret shared by every process, or tokens issued by one
  // process would not verify on another.
  'CSRF_SECRET',
  // FR-AUTH-09/11: verification and reset mail must reach a real relay. The
  // development defaults (Mailpit, no credentials) can never be used here.
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  // FR-AUTH-04a: Google is one of the three registration paths; a real
  // deployment never runs it with fake or missing credentials.
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  // FR-CONSENT-03: a consent is recorded against the published policy's
  // version, never the development placeholder.
  'PRIVACY_POLICY_VERSION',
];

/**
 * Validate a raw environment object into the frozen application configuration.
 *
 * Exported separately from the module-level singleton so tests can exercise the
 * validation rules without mutating the real process environment.
 *
 * @param {Record<string, string | undefined>} env raw environment
 * @returns {Readonly<object>} validated configuration
 */
export function loadConfig(env) {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${detail}`);
  }

  const value = parsed.data;

  if (STRICT_ENVIRONMENTS.has(value.NODE_ENV)) {
    const missing = REQUIRED_IN_STRICT_ENVIRONMENTS.filter(
      (name) => env[name] === undefined || env[name] === '',
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables in ${value.NODE_ENV}: ${missing.join(', ')}. ` +
          'See .env.example for the full list.',
      );
    }
  }

  const isProductionLike = STRICT_ENVIRONMENTS.has(value.NODE_ENV);

  if (isProductionLike && value.CSRF_SECRET.length < 32) {
    throw new Error('CSRF_SECRET must be at least 32 characters (SDD v1.1 §6.6).');
  }

  // NFR-SEC-11: in-memory counters are permitted for local development ONLY.
  // A staging or production boot configured for them fails here rather than
  // running with a rate limit that neither survives a restart nor holds across
  // processes.
  if (isProductionLike && value.RATE_LIMIT_STORE !== 'redis') {
    throw new Error(
      `RATE_LIMIT_STORE must be 'redis' in ${value.NODE_ENV} (NFR-SEC-11); ` +
        "'memory' is permitted in local development only.",
    );
  }

  // Test runs are silent unless the operator asks for output, so a failing
  // assertion is readable and a log line is never mistaken for test output.
  const logLevel =
    value.NODE_ENV === 'test' && env.LOG_LEVEL === undefined ? 'silent' : value.LOG_LEVEL;

  return Object.freeze({
    env: value.NODE_ENV,
    isProductionLike,
    port: value.PORT,
    baseUrl: value.APP_BASE_URL,
    trustProxyHops: value.TRUST_PROXY_HOPS,
    logLevel,

    mysql: Object.freeze({
      host: value.MYSQL_HOST,
      port: value.MYSQL_PORT,
      database: value.MYSQL_DATABASE,
      user: value.MYSQL_USER,
      password: value.MYSQL_PASSWORD,
      connectionLimit: value.MYSQL_POOL_SIZE,
    }),

    redis: Object.freeze({
      url: value.REDIS_URL,
    }),

    /** Rate-limit counter store selection (NFR-SEC-11). */
    rateLimitStore: value.RATE_LIMIT_STORE,

    /**
     * Audio asset storage (V4). `storageRoot` is resolved against the process
     * working directory when relative, so a deployment can point it at a volume
     * without the code caring where that is.
     */
    audio: Object.freeze({
      storageRoot: path.resolve(value.AUDIO_STORAGE_ROOT),
      publicPrefix: value.AUDIO_PUBLIC_PREFIX.replace(/\/+$/, ''),
    }),

    /**
     * Cloudflare Turnstile (FR-WORD-05). `isConfigured` is what the composition
     * root selects the verifier on, and what the views test before rendering
     * the widget — a site key with no secret behind it would render a challenge
     * nothing verifies.
     */
    turnstile: Object.freeze({
      siteKey: value.TURNSTILE_SITE_KEY,
      secretKey: value.TURNSTILE_SECRET_KEY,
      isConfigured: value.TURNSTILE_SITE_KEY !== '' && value.TURNSTILE_SECRET_KEY !== '',
    }),

    /** CSRF token key (SDD v1.1 §6.6). */
    csrf: Object.freeze({
      secret: value.CSRF_SECRET || randomBytes(32).toString('base64url'),
    }),

    /** Cloudflare cache purge on re-seed (SDD v1.1 §6.3). */
    cloudflareCachePurge: Object.freeze({
      zoneId: value.CLOUDFLARE_ZONE_ID,
      apiToken: value.CLOUDFLARE_CACHE_PURGE_TOKEN,
      isConfigured: value.CLOUDFLARE_ZONE_ID !== '' && value.CLOUDFLARE_CACHE_PURGE_TOKEN !== '',
    }),

    /**
     * Attributes of the anonymous identity cookie (FR-AUTH-01, SRS Appendix D).
     * `httpOnly` is deliberately false: the localStorage mirror of FR-AUTH-02
     * requires JavaScript read access. `secure` is relaxed only outside
     * production-like environments so the cookie works over plain HTTP locally.
     */
    anonymousCookie: Object.freeze({
      name: 'pa_uid',
      maxAgeSeconds: 63072000,
      httpOnly: false,
      secure: isProductionLike,
      sameSite: 'lax',
      path: '/',
    }),

    /**
     * Google sign-in (FR-AUTH-04a, FR-AUTH-16). `isConfigured` decides whether
     * the path is offered at all.
     */
    google: Object.freeze({
      clientId: value.GOOGLE_CLIENT_ID,
      clientSecret: value.GOOGLE_CLIENT_SECRET,
      redirectUri: value.GOOGLE_REDIRECT_URI || `${value.APP_BASE_URL.replace(/\/+$/, '')}/auth/google/callback`,
      isConfigured: value.GOOGLE_CLIENT_ID !== '' && value.GOOGLE_CLIENT_SECRET !== '',
    }),

    /** FR-CONSENT-03: the policy version consents are recorded against. */
    privacyPolicyVersion: value.PRIVACY_POLICY_VERSION,

    /** Outgoing SMTP (FR-AUTH-09/11); development defaults to Mailpit. */
    mail: Object.freeze({
      host: value.SMTP_HOST,
      port: value.SMTP_PORT,
      secure: value.SMTP_SECURE === 'true',
      user: value.SMTP_USER,
      password: value.SMTP_PASSWORD,
      from: value.MAIL_FROM,
    }),

    /**
     * The registered session cookie (FR-AUTH-12, SRS Appendix D). A session
     * cookie in the browser sense (no Max-Age): its lifetime is enforced by the
     * server-side record, 30 minutes idle and 12 hours absolute (V3).
     */
    sessionCookie: Object.freeze({
      name: 'pa_sid',
      httpOnly: true,
      secure: isProductionLike,
      sameSite: 'lax',
      path: '/',
    }),
  });
}

export const config = loadConfig(process.env);

export default config;
