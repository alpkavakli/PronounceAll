/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Deleting an account, in two steps (FR-SET-07; SDD v1.1 §5.5).
 *
 *   GET  /settings/delete          step 1: both options explained, and the
 *                                  re-authentication (password, or Google)
 *   POST /settings/delete/reauth   signed in → rate limit → CSRF → password → step 2
 *   GET  /settings/delete/google   signed in → a fresh Google round trip; the
 *                                  callback (`/auth/google/callback`) opens step 2
 *   POST /settings/delete          signed in → CSRF → the proof and the chosen
 *                                  option → signed out, and the outcome page
 *
 * Step 2 carries a single-use proof of the re-authentication in its form,
 * never in a URL. A wrong password stops the flow at step 1 with nothing
 * scheduled. DYNAMIC (private, no-store); plain forms, no JavaScript needed.
 */

import { Router } from 'express';

import { AppError, ERROR_CODES } from '../errors/index.js';
import { clearSessionCookie, csrfTokenFor, requireCsrf } from '../middleware/index.js';

const FORM_ERRORS = new Set([ERROR_CODES.VALIDATION, ERROR_CODES.FORBIDDEN]);

/**
 * Step 2, the choice. Shared with the Google callback, which opens it after a
 * fresh Google sign-in.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ nonce: string, error?: string|null }} view
 */
export function renderDeletionChoice(req, res, { nonce, error = null }) {
  res.setHeader('Referrer-Policy', 'strict-origin');
  res.render('delete-account', { title: 'Delete your account', step: 'choose', csrfToken: csrfTokenFor(req), nonce, error });
}

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../services/account-deletion.service.js').createAccountDeletionService>} dependencies.accountDeletionService
 * @param {ReturnType<import('../services/settings.service.js').createSettingsService>} dependencies.settingsService
 * @param {ReturnType<import('../services/google-sign-in.service.js').createGoogleSignInService> | null} dependencies.googleSignInService
 * @param {import('express').RequestHandler} dependencies.reauthRateLimit
 * @returns {import('express').Router}
 */
export function accountDeletionRouter({ accountDeletionService, settingsService, googleSignInService, reauthRateLimit }) {
  const router = Router();

  const requireSignedIn = (req, res, next) => (req.session ? next() : res.redirect(303, '/login'));

  async function renderExplanation(req, res, { error = null } = {}) {
    const { account } = await settingsService.describe({ userId: req.session.userId, anonymousId: req.anonymousId });
    res.render('delete-account', {
      title: 'Delete your account',
      step: 'explain',
      csrfToken: csrfTokenFor(req),
      provider: account?.provider ?? 'password',
      googleOffered: googleSignInService !== null,
      error,
    });
  }

  router.get('/settings/delete', requireSignedIn, async (req, res, next) => {
    try {
      await renderExplanation(req, res);
    } catch (error) {
      next(error);
    }
  });

  router.post('/settings/delete/reauth', requireSignedIn, reauthRateLimit, requireCsrf(), async (req, res, next) => {
    try {
      const nonce = await accountDeletionService.reauthenticateWithPassword({
        userId: req.session.userId,
        sessionId: req.session.sessionId,
        password: req.body.password,
      });
      renderDeletionChoice(req, res, { nonce });
    } catch (error) {
      if (AppError.isAppError(error) && FORM_ERRORS.has(error.code)) {
        res.status(error.status);
        await renderExplanation(req, res, { error: error.message }).catch(next);
        return;
      }
      next(error);
    }
  });

  router.get('/settings/delete/google', requireSignedIn, async (req, res, next) => {
    if (googleSignInService === null) {
      next(AppError.notFound());
      return;
    }
    try {
      const url = await googleSignInService.beginReauth({
        anonymousId: req.ensureAnonymousId(),
        userId: req.session.userId,
        sessionId: req.session.sessionId,
      });
      res.redirect(303, url);
    } catch (error) {
      next(error);
    }
  });

  router.post('/settings/delete', requireSignedIn, requireCsrf(), async (req, res, next) => {
    const nonce = typeof req.body.reauth === 'string' ? req.body.reauth : '';
    try {
      const { option } = await accountDeletionService.requestDeletion({
        userId: req.session.userId,
        sessionId: req.session.sessionId,
        nonce,
        option: req.body.option,
      });
      // FR-SET-07: "logs the user out" — every session already ended with the commit.
      clearSessionCookie(res);
      res.render('delete-account', { title: 'Account deleted', step: 'done', option, csrfToken: null, error: null });
    } catch (error) {
      if (AppError.isAppError(error) && error.code === ERROR_CODES.VALIDATION) {
        res.status(error.status);
        // No option chosen: the proof is unspent, so the choice can be made again.
        if (req.body.option !== 'soft' && req.body.option !== 'hard') {
          renderDeletionChoice(req, res, { nonce, error: error.message });
        } else {
          await renderExplanation(req, res, { error: error.message }).catch(next);
        }
        return;
      }
      next(error);
    }
  });

  return router;
}
