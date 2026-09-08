/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Security response headers and the Content Security Policy
 * (SDD v1.1 §6.3, amended NFR-SEC-03).
 *
 * The CSP has two shapes, selected by the response class of §6.3:
 *
 *   - The shared, edge-cached word-page shell cannot carry a per-response
 *     nonce, because the response is reused across viewers. It contains no
 *     inline script or style and therefore takes the nonce-free
 *     `script-src 'self'` / `style-src 'self'` policy.
 *   - Every uncached response takes the per-request nonce policy.
 *
 * A nonce is minted for every request and exposed to views as `cspNonce`. On a
 * shell response it goes unused, which is exactly the amended NFR-SEC-03 rule:
 * the shell's templates must not reference it.
 */

import crypto from 'node:crypto';

import helmet from 'helmet';

import { config } from '../config/index.js';
import { getResponseClass, RESPONSE_CLASS } from './response-class.js';

/**
 * @returns {import('express').RequestHandler} nonce minting, before helmet
 */
export function cspNonceMiddleware() {
  return function mintCspNonce(req, res, next) {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  };
}

/**
 * @returns {import('express').RequestHandler}
 */
export function securityHeadersMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'media-src': ["'self'"],
        'script-src': [
          "'self'",
          (req, res) =>
            getResponseClass(res) === RESPONSE_CLASS.SHELL
              ? "'self'"
              : `'nonce-${res.locals.cspNonce}'`,
        ],
        'style-src': [
          "'self'",
          (req, res) =>
            getResponseClass(res) === RESPONSE_CLASS.SHELL
              ? "'self'"
              : `'nonce-${res.locals.cspNonce}'`,
        ],
        ...(config.isProductionLike ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    // TLS is terminated at Cloudflare and Nginx; HSTS is only meaningful, and
    // only safe, on a production-like origin.
    strictTransportSecurity: config.isProductionLike
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
}
