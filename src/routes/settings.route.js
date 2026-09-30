/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Settings (FR-SET-01/03/04/05/06/10).
 *
 *   GET  /settings            account (signed in), cookie preferences, language,
 *                             sign-out; signed out, the account section explains
 *                             how to get one
 *   POST /settings/cookies    CSRF → the ads choice; essential cookies refused
 *
 * DYNAMIC (private, no-store). Plain forms, so everything works without
 * JavaScript.
 */

import { Router } from 'express';

import { csrfTokenFor, requireCsrf } from '../middleware/index.js';

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../services/settings.service.js').createSettingsService>} dependencies.settingsService
 * @returns {import('express').Router}
 */
export function settingsRouter({ settingsService }) {
  const router = Router();

  router.get('/settings', async (req, res, next) => {
    try {
      const details = await settingsService.describe({
        userId: req.session?.userId ?? null,
        anonymousId: req.anonymousId,
      });
      res.render('settings', {
        title: 'Settings',
        csrfToken: csrfTokenFor(req),
        signedIn: req.session !== null,
        saved: req.query.saved === 'cookies',
        ...details,
      });
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

  return router;
}
