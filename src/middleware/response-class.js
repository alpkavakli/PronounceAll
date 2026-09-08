/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Response classification and caching headers (SDD v1.1 §6.3, decisions B2, V4).
 *
 * Three response classes take three distinct caching postures, and two other
 * rules key off the same classification: whether the response may carry a
 * per-request CSP nonce (amended NFR-SEC-03) and whether it may carry a
 * `Set-Cookie` for `pa_uid` (amended FR-AUTH-01).
 *
 *   SHELL     the shared, edge-cached word-page shell. Identical for every
 *             viewer, long-lived edge cache, no per-viewer `Set-Cookie`, no
 *             per-response nonce, no inline script or style.
 *   HYDRATION the per-viewer JSON state endpoint. Never shared, never cached.
 *   DYNAMIC   every other response: settings, authentication, legal, and
 *             learning pages. Uncached, full per-request nonce CSP. Default.
 *
 * Content-addressed static assets are served by Nginx, not by Express, and are
 * therefore not a class handled here.
 */

import { onHeaders } from '../lib/http.js';

export const RESPONSE_CLASS = Object.freeze({
  SHELL: 'shell',
  HYDRATION: 'hydration',
  DYNAMIC: 'dynamic',
});

/**
 * Edge TTL for the cacheable shell, in seconds. Bounded deliberately: the seed
 * pipeline issues a targeted Cloudflare purge on re-seed, and this TTL is the
 * self-healing safety net for a missed purge (SDD v1.1 §6.3).
 */
export const SHELL_EDGE_TTL_SECONDS = 3600;

/** Stale-while-revalidate window for the shell, in seconds. */
export const SHELL_STALE_WHILE_REVALIDATE_SECONDS = 86400;

/**
 * Mark the response as the shared, edge-cacheable word-page shell (B2).
 * @param {import('express').Response} res
 */
export function markCacheableShell(res) {
  res.locals.responseClass = RESPONSE_CLASS.SHELL;
}

/**
 * Mark the response as the per-viewer hydration payload (B2).
 * @param {import('express').Response} res
 */
export function markHydration(res) {
  res.locals.responseClass = RESPONSE_CLASS.HYDRATION;
}

/**
 * @param {import('express').Response} res
 * @returns {string} the class chosen by the route, defaulting to DYNAMIC
 */
export function getResponseClass(res) {
  return res.locals.responseClass ?? RESPONSE_CLASS.DYNAMIC;
}

/**
 * Default every response to DYNAMIC and write the caching header for whichever
 * class the route ultimately selected.
 *
 * @returns {import('express').RequestHandler}
 */
export function responseClassMiddleware() {
  return function applyResponseClass(req, res, next) {
    res.locals.responseClass = RESPONSE_CLASS.DYNAMIC;

    onHeaders(res, () => {
      if (res.getHeader('Cache-Control') !== undefined) {
        return;
      }
      switch (getResponseClass(res)) {
        case RESPONSE_CLASS.SHELL:
          res.setHeader(
            'Cache-Control',
            `public, max-age=0, s-maxage=${SHELL_EDGE_TTL_SECONDS}, ` +
              `stale-while-revalidate=${SHELL_STALE_WHILE_REVALIDATE_SECONDS}`,
          );
          break;
        case RESPONSE_CLASS.HYDRATION:
        case RESPONSE_CLASS.DYNAMIC:
        default:
          res.setHeader('Cache-Control', 'private, no-store');
          break;
      }
    });

    next();
  };
}
