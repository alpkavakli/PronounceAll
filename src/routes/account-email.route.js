/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Email verification and password reset (FR-AUTH-09/10/11/14/15; SDD v1.1 §5.6).
 *
 *   GET  /verify-email?token=…        consume the link, then 303 to the result
 *   GET  /verify-email?status=…       the result page (no token in its URL)
 *   POST /verify-email/resend         3/h per account → CSRF → a new link, same answer for every address
 *   GET  /reset-password              the request form
 *   POST /reset-password              3/h per address → CSRF → Turnstile → a link, same answer for every address
 *   GET  /reset-password/confirm?token=…   the new-password form, if the link is still usable
 *   POST /reset-password/confirm      CSRF → set the password, end every session
 *
 * Every page is DYNAMIC (private, no-store). A page whose URL carries a token
 * sends `Referrer-Policy: strict-origin`, so the token never leaves in a Referer.
 * Verification does not sign anyone in, and a reset ends every session rather
 * than starting one.
 */

import { Router } from 'express';

import { AppError, ERROR_CODES } from '../errors/index.js';
import { csrfTokenFor, requireCsrf } from '../middleware/index.js';

const VERIFY_STATUSES = new Set(['verified', 'already-verified', 'expired', 'invalid']);
const FORM_ERRORS = new Set([ERROR_CODES.VALIDATION, ERROR_CODES.UNAVAILABLE]);

/**
 * A page whose URL carries a token sends at most its origin as a Referer, never
 * its path or query. `strict-origin`, not `no-referrer`: under `no-referrer` a
 * browser sends `Origin: null` with the page's own form POST, which the CSRF
 * same-origin check (SDD §6.6) rightly refuses.
 *
 * @param {import('express').Response} res
 */
const keepTokenOutOfReferer = (res) => res.setHeader('Referrer-Policy', 'strict-origin');

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../services/account-email.service.js').createAccountEmailService>} dependencies.accountEmailService
 * @param {import('express').RequestHandler} dependencies.resendRateLimit
 * @param {import('express').RequestHandler} dependencies.resetRateLimit
 * @returns {import('express').Router}
 */
export function accountEmailRouter({ accountEmailService, resendRateLimit, resetRateLimit }) {
  const router = Router();

  router.get('/verify-email', async (req, res, next) => {
    try {
      if (typeof req.query.token === 'string') {
        const status = await accountEmailService.verifyEmail(req.query.token);
        keepTokenOutOfReferer(res);
        res.redirect(303, `/verify-email?status=${status}`);
        return;
      }
      const status = VERIFY_STATUSES.has(req.query.status) ? req.query.status : 'invalid';
      res.status(status === 'verified' || status === 'already-verified' ? 200 : 400);
      res.render('verify-email', { title: 'Email verification', status, csrfToken: csrfTokenFor(req) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/verify-email/resend', resendRateLimit, requireCsrf(), async (req, res, next) => {
    try {
      await accountEmailService.resendVerification(req.body.email);
      res.render('check-email', { title: 'Check your email', reason: 'resend' });
    } catch (error) {
      next(error);
    }
  });

  const renderResetRequest = (req, res, { error = null, email = '' } = {}) =>
    res.render('reset-request', { title: 'Reset your password', csrfToken: csrfTokenFor(req), error, email });

  router.get('/reset-password', (req, res) => renderResetRequest(req, res));

  router.post('/reset-password', resetRateLimit, requireCsrf(), async (req, res, next) => {
    try {
      await accountEmailService.requestPasswordReset({
        email: req.body.email,
        turnstileToken: req.body['cf-turnstile-response'],
        remoteIp: req.ip,
      });
      res.render('check-email', { title: 'Check your email', reason: 'reset' });
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        renderResetRequest(req, res, { error: error.message, email: typeof req.body.email === 'string' ? req.body.email : '' });
        return;
      }
      next(error);
    }
  });

  const renderResetConfirm = (req, res, { token, status, error = null }) => {
    keepTokenOutOfReferer(res);
    res.render('reset-confirm', { title: 'Choose a new password', csrfToken: csrfTokenFor(req), token, status, error });
  };

  router.get('/reset-password/confirm', async (req, res, next) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const status = await accountEmailService.inspectResetToken(token);
      if (status !== 'valid') res.status(400);
      renderResetConfirm(req, res, { token: status === 'valid' ? token : '', status });
    } catch (error) {
      next(error);
    }
  });

  router.post('/reset-password/confirm', requireCsrf(), async (req, res, next) => {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    try {
      await accountEmailService.resetPassword({ token, password: req.body.password });
      res.redirect(303, '/login?password-reset=1');
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        // The link may have been the problem; ask the service which page applies.
        const status = await accountEmailService.inspectResetToken(token);
        renderResetConfirm(req, res, { token: status === 'valid' ? token : '', status, error: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}
