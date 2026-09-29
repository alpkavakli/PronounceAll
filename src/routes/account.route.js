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
 * login is one auth transition, complete in its own response whatever the
 * redirect target (§5.1): merge the carried `pa_uid`, start a fresh session
 * (`pa_sid`, rotated on login), replace a bound `pa_uid` with a fresh one, then
 * redirect. The server also refuses a retired `pa_uid` wherever it is presented
 * later (`retiredIdentityMiddleware`), so no page has to finish the switch.
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
const FORM_ERRORS = new Set([ERROR_CODES.VALIDATION, ERROR_CODES.CONFLICT, ERROR_CODES.AUTH, ERROR_CODES.UNAVAILABLE]);

/** Where a successful sign-in lands. Presentation only; see finishSignIn. */
const POST_SIGN_IN_DESTINATION = '/login';

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../services/account.service.js').createAccountService>} dependencies.accountService
 * @param {ReturnType<import('../services/session.service.js').createSessionService>} dependencies.sessionService
 * @param {import('express').RequestHandler} dependencies.loginRateLimit
 * @param {import('express').RequestHandler} dependencies.registerRateLimit
 * @param {ReturnType<import('../services/google-sign-in.service.js').createGoogleSignInService> | null} [dependencies.googleSignInService]
 *   null when Google is not configured (development only): the path is not offered
 * @returns {import('express').Router}
 */
export function accountRouter({
  accountService,
  sessionService,
  loginRateLimit,
  registerRateLimit,
  googleSignInService = null,
}) {
  const router = Router();
  const googleOffered = googleSignInService !== null;

  const renderRegister = (req, res, { error = null, username = '', email = '' } = {}) =>
    res.render('register', {
      title: 'Create an account',
      csrfToken: csrfTokenFor(req),
      error,
      username,
      email,
      googleOffered,
    });

  /** The Google username step. Its form carries the pending nonce, never the identity. */
  const renderGoogleUsername = (req, res, { pendingNonce, email, error = null, username = '' }) => {
    res.setHeader('Referrer-Policy', 'strict-origin');
    res.render('register-google', {
      title: 'Choose a username',
      csrfToken: csrfTokenFor(req),
      pendingNonce,
      email,
      error,
      username,
    });
  };

  /** Every failed Google attempt looks the same; the reason is only logged. */
  const renderGoogleFailed = (res, { cancelled = false } = {}) => {
    res.status(400);
    res.render('google-failed', { title: 'Google sign-in', cancelled });
  };

  const renderLogin = (req, res, { error = null, identifier = '', pendingEmail = null } = {}) =>
    res.render('login', {
      title: req.session ? 'Your account' : 'Sign in',
      csrfToken: csrfTokenFor(req),
      error,
      identifier,
      pendingEmail,
      passwordWasReset: req.query['password-reset'] === '1',
      signedInAs: req.session?.username ?? null,
      googleOffered,
    });

  /**
   * The auth transition, in this order: merge (LINK), session, `pa_uid`
   * rotation, response. The redirect target plays no part in it.
   */
  async function finishSignIn(req, res, authenticated) {
    // Signing in again replaces the current session rather than adding one.
    if (req.session) await sessionService.endSession(req.session);
    const { sessionId, retireAnonymousId } = await accountService.completeSignIn(authenticated, req.anonymousId);
    setSessionCookie(res, sessionId);
    if (retireAnonymousId) retireAnonymousIdentity(req);
    res.redirect(303, POST_SIGN_IN_DESTINATION);
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
    const email = typeof req.body.email === 'string' ? req.body.email : '';

    // Path A (SDD §5.6): the same endpoint, gates and rate limit; the form
    // carries only the pending nonce.
    if (req.body.googlePending !== undefined) {
      if (!googleOffered) {
        next(AppError.notFound());
        return;
      }
      const pendingNonce = req.body.googlePending;
      try {
        const registered = await googleSignInService.register({
          pendingNonce,
          username: req.body.username,
          anonymousId: req.anonymousId,
          turnstileToken: req.body['cf-turnstile-response'],
          remoteIp: req.ip,
        });
        await finishSignIn(req, res, registered);
      } catch (error) {
        if (AppError.isAppError(error) && error.meta?.restart) {
          renderGoogleFailed(res);
          return;
        }
        if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
          res.status(error.status);
          renderGoogleUsername(req, res, { pendingNonce, email: null, error: error.message, username });
          return;
        }
        next(error);
      }
      return;
    }

    try {
      const registered = await accountService.register({
        username: req.body.username,
        email: req.body.email,
        password: req.body.password,
        acknowledgedNoRecovery: req.body.acknowledgeNoRecovery === 'yes',
        turnstileToken: req.body['cf-turnstile-response'],
        remoteIp: req.ip,
      });
      if (registered.verificationRequired) {
        // FR-AUTH-09: no sign-in until the email is verified.
        res.render('check-email', { title: 'Check your email', reason: 'verification' });
        return;
      }
      await finishSignIn(req, res, registered);
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        renderRegister(req, res, { error: error.message, username, email });
        return;
      }
      next(error);
    }
  });

  router.get('/login', (req, res) => renderLogin(req, res));

  router.post('/login', loginRateLimit, requireCsrf(), async (req, res, next) => {
    const identifier = typeof req.body.identifier === 'string' ? req.body.identifier : '';
    try {
      const outcome = await accountService.login({
        identifier: req.body.identifier,
        password: req.body.password,
        turnstileToken: req.body['cf-turnstile-response'],
        remoteIp: req.ip,
      });
      if (outcome.verificationPending) {
        // FR-AUTH-09 / FR-AUTH-13: said only after a correct credential pair.
        res.status(403);
        renderLogin(req, res, { identifier, pendingEmail: outcome.email });
        return;
      }
      await finishSignIn(req, res, outcome);
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        renderLogin(req, res, { error: error.message, identifier });
        return;
      }
      next(error);
    }
  });

  /**
   * FR-AUTH-04a: start Google sign-in. Only this request, made when the person
   * chooses "Continue with Google", sends anyone to Google (NFR-PRIV-05).
   */
  router.get('/auth/google', async (req, res, next) => {
    if (!googleOffered) {
      next(AppError.notFound());
      return;
    }
    try {
      const url = await googleSignInService.begin({ anonymousId: req.ensureAnonymousId() });
      res.redirect(303, url);
    } catch (error) {
      next(error);
    }
  });

  /**
   * The OAuth callback. A signed-in outcome goes through the same auth
   * transition as a password sign-in; anything else creates, links and merges
   * nothing.
   */
  router.get('/auth/google/callback', async (req, res, next) => {
    if (!googleOffered) {
      next(AppError.notFound());
      return;
    }
    // The URL carries the code and state; never let it leave in a Referer.
    res.setHeader('Referrer-Policy', 'strict-origin');
    try {
      const outcome = await googleSignInService.complete({
        state: req.query.state,
        code: req.query.code,
        error: req.query.error,
        anonymousId: req.anonymousId,
      });
      if (outcome.kind === 'signed-in') {
        await finishSignIn(req, res, outcome);
      } else if (outcome.kind === 'needs-username') {
        renderGoogleUsername(req, res, { pendingNonce: outcome.pendingNonce, email: outcome.email });
      } else {
        renderGoogleFailed(res, { cancelled: outcome.kind === 'cancelled' });
      }
    } catch (error) {
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
