/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Settings (FR-SET-01/02/03/04/05/06/10).
 *
 *   GET  /settings                  account (signed in), cookie preferences,
 *                                   language, sign-out; signed out, the account
 *                                   section explains how to get one
 *   POST /settings/cookies          CSRF → the ads choice; essential cookies refused
 *   POST /settings/password         signed in → rate limit → CSRF → change password
 *   POST /settings/email            signed in → rate limit → CSRF → request an email change
 *   GET  /settings/email/confirm    the confirmation link; never signs in
 *
 * DYNAMIC (private, no-store). Plain forms, so everything works without
 * JavaScript; a form error re-renders the page with the message in place.
 */

import { Router } from 'express';

import { AppError, ERROR_CODES } from '../errors/index.js';
import { csrfTokenFor, requireCsrf, setSessionCookie } from '../middleware/index.js';

const FORM_ERRORS = new Set([ERROR_CODES.VALIDATION, ERROR_CODES.UNAVAILABLE, ERROR_CODES.FORBIDDEN]);
const SAVED_NOTICES = Object.freeze({
  cookies: 'Your cookie preferences are saved.',
  password: 'Your password is changed. Every other device was signed out.',
  'email-sent': 'Check your new address: we sent a link to confirm it. Your current email stays active until then.',
  'email-changed': 'Your new email address is confirmed.',
});
const EMAIL_LINK_PROBLEMS = Object.freeze({
  expired: 'That confirmation link has expired. Ask for the change again.',
  invalid: 'That confirmation link cannot be used. It may have been used already or replaced by a newer one.',
});

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../services/settings.service.js').createSettingsService>} dependencies.settingsService
 * @param {ReturnType<import('../services/account-settings.service.js').createAccountSettingsService>} dependencies.accountSettingsService
 * @param {import('express').RequestHandler} dependencies.passwordRateLimit
 * @param {import('express').RequestHandler} dependencies.emailChangeRateLimit
 * @returns {import('express').Router}
 */
export function settingsRouter({ settingsService, accountSettingsService, passwordRateLimit, emailChangeRateLimit }) {
  const router = Router();

  async function renderSettings(req, res, { passwordError = null, emailError = null, emailValue = '', linkProblem = null } = {}) {
    const details = await settingsService.describe({
      userId: req.session?.userId ?? null,
      anonymousId: req.anonymousId,
    });
    res.render('settings', {
      title: 'Settings',
      csrfToken: csrfTokenFor(req),
      signedIn: req.session !== null,
      notice: SAVED_NOTICES[req.query.saved] ?? null,
      linkProblem,
      passwordError,
      emailError,
      emailValue,
      ...details,
    });
  }

  /** The account forms need a signed-in viewer; anyone else goes to sign in. */
  const requireSignedIn = (req, res, next) => (req.session ? next() : res.redirect(303, '/login'));

  router.get('/settings', async (req, res, next) => {
    try {
      await renderSettings(req, res);
    } catch (error) {
      next(error);
    }
  });

  router.post('/settings/cookies', requireCsrf(), async (req, res, next) => {
    try {
      await settingsService.saveCookiePreferences(
        { userId: req.session?.userId ?? null, anonymousId: req.ensureAnonymousId() },
        req.body ?? {},
      );
      res.redirect(303, '/settings?saved=cookies');
    } catch (error) {
      next(error);
    }
  });

  router.post('/settings/password', requireSignedIn, passwordRateLimit, requireCsrf(), async (req, res, next) => {
    try {
      const { sessionId } = await accountSettingsService.changePassword({
        userId: req.session.userId,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
      });
      // FR-AUTH-12: this device continues on a new session id.
      setSessionCookie(res, sessionId);
      res.redirect(303, '/settings?saved=password');
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        await renderSettings(req, res, { passwordError: error.message }).catch(next);
        return;
      }
      next(error);
    }
  });

  router.post('/settings/email', requireSignedIn, emailChangeRateLimit, requireCsrf(), async (req, res, next) => {
    try {
      await accountSettingsService.requestEmailChange({
        userId: req.session.userId,
        currentPassword: req.body.currentPassword,
        newEmail: req.body.email,
      });
      res.redirect(303, '/settings?saved=email-sent');
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        const emailValue = typeof req.body.email === 'string' ? req.body.email : '';
        await renderSettings(req, res, { emailError: error.message, emailValue }).catch(next);
        return;
      }
      next(error);
    }
  });

  router.get('/settings/email/confirm', async (req, res, next) => {
    try {
      const outcome = await accountSettingsService.confirmEmailChange(req.query.token);
      res.setHeader('Referrer-Policy', 'strict-origin');
      if (outcome === 'changed') {
        res.redirect(303, '/settings?saved=email-changed');
        return;
      }
      res.status(400);
      await renderSettings(req, res, { linkProblem: EMAIL_LINK_PROBLEMS[outcome] });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
