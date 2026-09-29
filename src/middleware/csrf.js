/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * CSRF enforcement for state-changing routes (FR-AUTH-20, SDD v1.1 §6.6).
 *
 * The token comes from the `X-CSRF-Token` header (JavaScript) or the `_csrf`
 * form field (no-JavaScript forms). It is verified against the identity the
 * request actually carries: the signed-in session when there is one, otherwise
 * the `pa_uid`. A request with neither has no identity a token could have been
 * issued for, so it fails. Failure is a 403 with no state change.
 */

import { config } from '../config/index.js';
import { AppError } from '../errors/index.js';
import { isSameOrigin, issueCsrfTokenFor, verifyCsrfTokenFor } from '../services/csrf.service.js';

/**
 * The CSRF subject a request carries.
 *
 * @param {import('express').Request} req
 * @param {{ mint?: boolean }} [options] `mint` issues a `pa_uid` when there is
 *   none, for a response that hands out a token
 * @returns {import('../services/csrf.service.js').CsrfSubject}
 */
export function csrfSubjectOf(req, { mint = false } = {}) {
  if (req.session) return { sessionId: req.session.sessionId };
  return { anonymousId: mint ? req.ensureAnonymousId() : req.anonymousId };
}

/**
 * The token for an uncached per-viewer response (§6.6 issuance).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export function csrfTokenFor(req) {
  return issueCsrfTokenFor(config.csrf.secret, csrfSubjectOf(req, { mint: true }));
}

/**
 * @returns {import('express').RequestHandler}
 */
export function requireCsrf() {
  const configuredOrigin = new URL(config.baseUrl).origin;

  return function enforceCsrf(req, res, next) {
    const allowedOrigins = [configuredOrigin, `${req.protocol}://${req.get('host')}`];
    const sameOrigin = isSameOrigin({
      origin: req.get('origin'),
      fetchSite: req.get('sec-fetch-site'),
      allowedOrigins,
    });
    const presented = req.get('x-csrf-token') ?? req.body?._csrf;

    if (!sameOrigin || !verifyCsrfTokenFor(config.csrf.secret, csrfSubjectOf(req), presented)) {
      next(AppError.forbidden('This request could not be verified. Reload the page and try again.'));
      return;
    }
    next();
  };
}
