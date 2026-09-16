/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * CSRF enforcement for state-changing routes (FR-AUTH-20, SDD v1.1 §6.6).
 *
 * The token comes from the `X-CSRF-Token` header (JavaScript) or the `_csrf`
 * form field (the no-JavaScript confirmation page). It is verified against the
 * identity the request actually carries: a request with no `pa_uid` cookie has
 * no identity a token could have been issued for, so it fails. Failure is a 403
 * with no state change.
 */

import { config } from '../config/index.js';
import { AppError } from '../errors/index.js';
import { isSameOrigin, verifyCsrfToken } from '../services/csrf.service.js';

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

    if (!sameOrigin || !verifyCsrfToken(config.csrf.secret, req.anonymousId, presented)) {
      next(AppError.forbidden('This request could not be verified. Reload the page and try again.'));
      return;
    }
    next();
  };
}
