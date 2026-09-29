/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Registration, sign-in and sign-out (FR-AUTH-04/05/07/12/13/14/15/18,
 * FR-CONSENT-04, FR-SET-06; SDD v1.1 §5.1, §5.6).
 *
 *   GET  /register   the form (uncached; carries the CSRF token and Turnstile)
 *   POST /register   rate limit (3/h per IP) → CSRF → Turnstile → rules → insert
 *   GET  /login      the form, or "signed in as …" with a sign-out button
 *   POST /login      rate limit (5/15 min per UUID + IP) → CSRF → Turnstile → check
 *   POST /logout     CSRF → end the session, clear `pa_sid`, back to `/`
 *
 * Every page here is DYNAMIC (private, no-store). A successful registration or
 * login merges the carried `pa_uid` (§5.1), sets a fresh `pa_sid` (rotation on
 * login) and, when the `pa_uid` was bound, replaces it with a fresh one; it then
 * lands on `/login?signed-in=1`, whose page tells the browser script to adopt
 * the new `pa_uid` rather than restore the retired one from its mirror.
 *
 * Form errors re-render the form with the message and the status of the error,
 * so the page works without JavaScript and nothing typed except the password
 * is lost.
 */

import { Router } from 'express';

import { AppError, ERROR_CODES } from '../errors/index.js';
import {
  clearSessionCookie,
  csrfTokenFor,
  requireCsrf,
  retireAnonymousIdentity,
  setSessionCookie,
} from '../middleware/index.js';

/** Errors a form shows in place; anything else goes to the error page. */
const FORM_ERRORS = new Set([ERROR_CODES.VALIDATION, ERROR_CODES.CONFLICT, ERROR_CODES.AUTH]);

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../services/account.service.js').createAccountService>} dependencies.accountService
 * @param {ReturnType<import('../services/session.service.js').createSessionService>} dependencies.sessionService
 * @param {import('express').RequestHandler} dependencies.loginRateLimit
 * @param {import('express').RequestHandler} dependencies.registerRateLimit
 * @returns {import('express').Router}
 */
export function accountRouter({ accountService, sessionService, loginRateLimit, registerRateLimit }) {
  const router = Router();

  const renderRegister = (req, res, { error = null, username = '' } = {}) =>
    res.render('register', { title: 'Create an account', csrfToken: csrfTokenFor(req), error, username });

  const renderLogin = (req, res, { error = null, identifier = '' } = {}) =>
    res.render('login', {
      title: req.session ? 'Your account' : 'Sign in',
      csrfToken: csrfTokenFor(req),
      error,
      identifier,
      signedInAs: req.session?.username ?? null,
      justSignedIn: req.session !== null && req.query['signed-in'] === '1',
    });

  /** Sign-in has succeeded: merge, rotate, land. */
  async function finishSignIn(req, res, authenticated) {
    // Signing in again replaces the current session rather than adding one.
    if (req.session) await sessionService.endSession(req.session);
    const { sessionId, retireAnonymousId } = await accountService.completeSignIn(authenticated, req.anonymousId);
    setSessionCookie(res, sessionId);
    if (retireAnonymousId) retireAnonymousIdentity(req);
    res.redirect(303, '/login?signed-in=1');
  }

  router.get('/register', (req, res) => {
    if (req.session) {
      res.redirect(303, '/login');
      return;
    }
    renderRegister(req, res);
  });

  router.post('/register', registerRateLimit, requireCsrf(), async (req, res, next) => {
    const username = typeof req.body.username === 'string' ? req.body.username : '';
    try {
      const authenticated = await accountService.registerWithUsername({
        username: req.body.username,
        password: req.body.password,
        acknowledgedNoRecovery: req.body.acknowledgeNoRecovery === 'yes',
        turnstileToken: req.body['cf-turnstile-response'],
        remoteIp: req.ip,
      });
      await finishSignIn(req, res, authenticated);
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        renderRegister(req, res, { error: error.message, username });
        return;
      }
      next(error);
    }
  });

  router.get('/login', (req, res) => renderLogin(req, res));

  router.post('/login', loginRateLimit, requireCsrf(), async (req, res, next) => {
    const identifier = typeof req.body.identifier === 'string' ? req.body.identifier : '';
    try {
      const authenticated = await accountService.login({
        identifier: req.body.identifier,
        password: req.body.password,
        turnstileToken: req.body['cf-turnstile-response'],
        remoteIp: req.ip,
      });
      await finishSignIn(req, res, authenticated);
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        renderLogin(req, res, { error: error.message, identifier });
        return;
      }
      next(error);
    }
  });

  // FR-SET-06: end the session and clear `pa_sid`; `pa_uid` is left as it is.
  // With no live session there is nothing to protect, and the form's token was
  // bound to a session that has already ended, so the cookie is simply cleared.
  const clearAndLeave = (res) => {
    clearSessionCookie(res);
    res.redirect(303, '/');
  };
  router.post(
    '/logout',
    (req, res, next) => (req.session ? next() : clearAndLeave(res)),
    requireCsrf(),
    async (req, res, next) => {
      try {
        await sessionService.endSession(req.session);
        clearAndLeave(res);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
