/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The registered session on each request (FR-AUTH-12, V3; SDD v1.1 §4.10).
 *
 * `req.session` is the validated session or null. Validation compares the
 * stored epoch with `users.session_epoch` and slides the idle window, in the
 * session service. Anything that does not validate — a missing, expired,
 * superseded or unknown value, or Redis being unreachable — is simply "not
 * signed in": the failure is closed, never an error page.
 *
 * `pa_sid` is set only by the sign-in and sign-out responses, which are
 * uncached, so it never rides on the shared word-page shell (B2).
 */

import { config } from '../config/index.js';
import { generateAnonymousId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

/**
 * @param {object} dependencies
 * @param {{ resolveSession: (id: string|undefined) => Promise<object|null> }} dependencies.sessionService
 * @returns {import('express').RequestHandler}
 */
export function sessionMiddleware({ sessionService }) {
  return async function resolveRegisteredSession(req, res, next) {
    req.session = null;
    const presented = req.cookies?.[config.sessionCookie.name];
    if (presented) {
      try {
        req.session = await sessionService.resolveSession(presented);
      } catch (error) {
        logger.error({ err: error }, 'Session store unavailable; request treated as signed out');
      }
    }
    res.locals.signedInAs = req.session?.username ?? null;
    next();
  };
}

/** @param {string} sessionId @returns {string} */
function serialiseSessionCookie(sessionId, extra = []) {
  const cookie = config.sessionCookie;
  return [
    `${cookie.name}=${sessionId}`,
    `Path=${cookie.path}`,
    'HttpOnly',
    cookie.secure ? 'Secure' : null,
    'SameSite=Lax',
    ...extra,
  ]
    .filter(Boolean)
    .join('; ');
}

/** @param {import('express').Response} res @param {string} sessionId */
export function setSessionCookie(res, sessionId) {
  res.append('Set-Cookie', serialiseSessionCookie(sessionId));
}

/** FR-SET-06: unset with `Max-Age=0`. @param {import('express').Response} res */
export function clearSessionCookie(res) {
  res.append('Set-Cookie', serialiseSessionCookie('', ['Max-Age=0']));
}

/**
 * SDD §5.1: replace the carried `pa_uid` with a fresh unbound one. The identity
 * middleware writes whatever `req.anonymousId` holds when headers flush, so the
 * response carries the new cookie.
 *
 * @param {import('express').Request} req
 */
export function retireAnonymousIdentity(req) {
  req.anonymousId = generateAnonymousId();
}
