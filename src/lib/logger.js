/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The shared structured logger (SDD v1.1 §6.2, decisions C1, NFR-SEC-10).
 *
 * Logging is pino, emitting structured JSON lines through this single module.
 * Handlers and services log through it and never through `console`, so format,
 * redaction, and destination have one enforcement point.
 *
 * Redaction here is defence in depth over a stricter primary rule: sensitive
 * values must never enter a log object at all — handlers do not log raw request
 * bodies on the authentication or save routes, and sensitive fields are not
 * attached to log context. This `redact` configuration is the backstop.
 *
 * IP addresses are deliberately absent: they are logged in the Nginx access
 * logs only, which hold a different retention window (NFR-SEC-10, NFR-OPS-04).
 */

import pino from 'pino';

import { config } from '../config/index.js';

/**
 * Field paths scrubbed from every log line. Because pino redaction operates on
 * known paths, the field names under which request and user context may be
 * logged are fixed here, so a sensitive value cannot pass through under an
 * unredacted key. Covers the NFR-SEC-10 forbidden values: passwords whether
 * plaintext or hashed, session and CSRF tokens, password-reset and
 * email-verification tokens, OAuth access and refresh tokens, idempotency keys
 * tied to authentication flows, HIBP k-anonymity query content, and complete
 * email addresses.
 */
export const REDACTED_PATHS = Object.freeze([
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'tokenHash',
  'token_hash',
  'sessionId',
  'session_id',
  'csrfToken',
  'csrf_token',
  'resetToken',
  'verificationToken',
  'accessToken',
  'refreshToken',
  'idToken',
  'idempotencyKey',
  'hibpPrefix',
  'hibpRange',
  'email',
  'emailLower',
  'email_lower',
  'authorization',
  'cookie',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.email',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body',
  'res.headers["set-cookie"]',
]);

export const logger = pino({
  level: config.logLevel,
  base: { service: 'pronounceall', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [...REDACTED_PATHS],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export default logger;
