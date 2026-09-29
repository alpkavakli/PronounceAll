/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The anonymous identity cookie (FR-AUTH-01, FR-AUTH-03, SRS Appendix D).
 *
 * `pa_uid` is a v4 UUID with `HttpOnly=false` — the localStorage mirror of
 * FR-AUTH-02 needs JavaScript read access, an accepted tradeoff recorded in
 * Foundational Decisions §6 — plus `Secure`, `SameSite=Lax`, `Path=/`, and a
 * sliding two-year `Max-Age`.
 *
 * Because the word-page shell is a shared, edge-cached response (B2), it must
 * not carry a per-viewer `Set-Cookie`, and a cache hit on it never reaches the
 * origin at all. The cookie is therefore issued, and its `Max-Age` refreshed,
 * only on uncached origin-reaching responses: the viewer bootstrap or hydration
 * request for a client running JavaScript, and otherwise the first write or
 * other non-cached request.
 *
 * No `anonymous_profiles` row is created here. Per FR-AUTH-03 the row is
 * created only on the first *write* from a UUID, so a read-only visitor never
 * causes a database row.
 */

import { config } from '../config/index.js';
import { onHeaders } from '../lib/http.js';
import { generateAnonymousId, isValidAnonymousId } from '../lib/ids.js';
import { getResponseClass, RESPONSE_CLASS } from './response-class.js';

/**
 * @returns {import('express').RequestHandler}
 */
export function anonymousIdentityMiddleware() {
  const cookie = config.anonymousCookie;

  return function resolveAnonymousIdentity(req, res, next) {
    const presented = req.cookies?.[cookie.name];
    const carried = isValidAnonymousId(presented) ? presented : null;

    // A malformed or absent value is replaced rather than trusted; the
    // replacement is only committed to a response that is allowed to set it.
    req.anonymousId = carried;

    /**
     * Return the caller's anonymous identity, minting one if the request did
     * not carry a valid cookie. Used by write paths that need an identity
     * before the response is composed.
     *
     * @returns {string} a valid v4 UUID
     */
    req.ensureAnonymousId = function ensureAnonymousId() {
      req.anonymousId ??= generateAnonymousId();
      return req.anonymousId;
    };

    onHeaders(res, () => {
      // The cacheable shell is shared across viewers; issuing or refreshing the
      // cookie there would leak one viewer's identity to every other viewer of
      // the same cached response (amended FR-AUTH-01, B2).
      if (getResponseClass(res) === RESPONSE_CLASS.SHELL) {
        return;
      }

      const serialised = [
        `${cookie.name}=${req.ensureAnonymousId()}`,
        `Max-Age=${cookie.maxAgeSeconds}`,
        `Path=${cookie.path}`,
        cookie.secure ? 'Secure' : null,
        `SameSite=${cookie.sameSite === 'lax' ? 'Lax' : cookie.sameSite}`,
      ]
        .filter(Boolean)
        .join('; ');

      // Append rather than assign: other cookies may already be staged on this
      // response, and only a prior `pa_uid` should be displaced.
      const existing = res.getHeader('Set-Cookie');
      const staged = existing === undefined ? [] : [existing].flat();
      res.setHeader('Set-Cookie', [
        ...staged.filter((entry) => !String(entry).startsWith(`${cookie.name}=`)),
        serialised,
      ]);
    });

    next();
  };
}

/**
 * A retired identity is never taken back (SDD v1.1 §5.1, FR-AUTH-18).
 *
 * Signing in binds the carried `pa_uid` and the sign-in response replaces it
 * with a fresh one. A browser can still present the old value later — restored
 * from its localStorage mirror (FR-AUTH-02), or from a copy of the cookie. A
 * bound identity presented on any request is therefore swapped for a fresh one
 * here, before any route runs, so signed-out activity never resolves back into
 * the account whatever page the browser went to after signing in. The fresh
 * value is issued by the ordinary cookie write above on the next uncached
 * response, which is always the hydration read for a page with JavaScript.
 *
 * @param {object} dependencies
 * @param {(anonymousId: string) => Promise<boolean>} dependencies.isRetiredAnonymousId
 * @returns {import('express').RequestHandler}
 */
export function retiredIdentityMiddleware({ isRetiredAnonymousId }) {
  return async function replaceRetiredIdentity(req, res, next) {
    try {
      if (req.anonymousId && (await isRetiredAnonymousId(req.anonymousId))) {
        req.anonymousId = generateAnonymousId();
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
