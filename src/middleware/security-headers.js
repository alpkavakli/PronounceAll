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
import { onHeaders } from '../lib/http.js';
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
 * Cloudflare Turnstile serves its challenge script and its iframe from this
 * origin (FR-WORD-05). It is added to the policy ONLY when Turnstile is
 * actually configured, so a deployment that does not use it keeps the tighter
 * `'self'`-only policy rather than carrying a permanently widened CSP.
 */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** @returns {string[]} the extra script origins this deployment permits */
function extraScriptSources() {
  return config.turnstile.isConfigured ? [TURNSTILE_ORIGIN] : [];
}

/**
 * Compose the policy for one response, given its class.
 *
 * @param {string} responseClass
 * @param {string} nonce
 * @returns {string}
 */
function buildPolicy(responseClass, nonce) {
  const isShell = responseClass === RESPONSE_CLASS.SHELL;

  // The shell is shared across viewers and edge-cached, so a per-response nonce
  // in its policy would be reused by every later viewer and would authorise
  // nothing meaningfully. It carries no inline script or style, so it takes the
  // nonce-free `'self'` policy instead (amended NFR-SEC-03).
  const scriptSrc = isShell
    ? ["'self'", ...extraScriptSources()]
    : ["'self'", ...extraScriptSources(), `'nonce-${nonce}'`];
  const styleSrc = isShell ? ["'self'"] : ["'self'", `'nonce-${nonce}'`];

  const directives = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['media-src', ["'self'"]],
    ['script-src', scriptSrc],
    ['style-src', styleSrc],
    // The Turnstile widget renders in a cross-origin iframe. `default-src`
    // would otherwise restrict it to `'self'` and the challenge would not load.
    // Absent entirely when Turnstile is not configured.
    ...(config.turnstile.isConfigured ? [['frame-src', [TURNSTILE_ORIGIN]]] : []),
    ...(config.isProductionLike ? [['upgrade-insecure-requests', []]] : []),
  ];

  return directives
    .map(([name, values]) => (values.length === 0 ? name : `${name} ${values.join(' ')}`))
    .join(';');
}

/**
 * Write the Content Security Policy at header-flush time.
 *
 * It cannot be written when this middleware runs: the policy depends on the
 * response CLASS, and the class is chosen later by the route that renders. That
 * ordering is why the CSP is written here rather than through helmet's own
 * `contentSecurityPolicy` option — helmet resolves its directives eagerly, when
 * the middleware executes, at which point every response still looks DYNAMIC
 * and the shell would be handed a nonce it must not carry.
 *
 * @returns {import('express').RequestHandler}
 */
export function contentSecurityPolicyMiddleware() {
  return function applyContentSecurityPolicy(req, res, next) {
    onHeaders(res, () => {
      res.setHeader(
        'Content-Security-Policy',
        buildPolicy(getResponseClass(res), res.locals.cspNonce),
      );
    });
    next();
  };
}

/**
 * @returns {import('express').RequestHandler}
 */
export function securityHeadersMiddleware() {
  return helmet({
    // Written by `contentSecurityPolicyMiddleware` instead; see above.
    contentSecurityPolicy: false,
    // TLS is terminated at Cloudflare and Nginx; HSTS is only meaningful, and
    // only safe, on a production-like origin.
    strictTransportSecurity: config.isProductionLike
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
}
