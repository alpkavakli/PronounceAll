/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The save and tag write, and its no-JavaScript confirmation page (FR-SAVE-01,
 * FR-SAVE-02, FR-SAVE-07, FR-SAVE-08, FR-AUTH-20; SDD v1.1 §5.2, §6.6).
 *
 *   GET  /save/confirm?kind=word&id=12&return=/en-us/cupcake
 *        An uncached, private page. It resolves or issues `pa_uid` and renders a
 *        one-button form carrying the CSRF token, a server-generated idempotency
 *        key, the target and a safe return path.
 *
 *   POST /save
 *        Rate-limited, CSRF-verified. A JSON request answers with the resulting
 *        state; a form submission answers 303 to its return path.
 *
 * Registered before the word router, whose `/:variant` and `/:variant/:word`
 * patterns would otherwise match `/save` and `/save/confirm`.
 */

import { Router } from 'express';

import { config } from '../config/index.js';
import { AppError } from '../errors/index.js';
import { issueConfirmationCredentials } from '../services/csrf.service.js';
import { jsonErrorSurface, requireCsrf } from '../middleware/index.js';
import { describeTarget, getViewerState } from '../services/viewer-state.service.js';
import { requireActiveVariant } from '../services/word-page.service.js';
import { parseConfirmQuery, parseSaveRequest, safeReturnPath } from '../validators/progress.validator.js';

/**
 * @param {object} dependencies
 * @param {import('express').RequestHandler} dependencies.saveRateLimit
 * @param {{ applySaveAction: Function }} dependencies.saveStateService
 * @returns {import('express').Router}
 */
export function saveRouter({ saveRateLimit, saveStateService }) {
  const router = Router();

  router.get('/save/confirm', async (req, res, next) => {
    try {
      const { targetKind, targetId, returnTo } = parseConfirmQuery(req.query);
      const target = await describeTarget(targetKind, targetId);
      if (!target) throw AppError.notFound('That word or sound does not exist.');

      const variant = await requireActiveVariant(target.variantCode);
      const anonymousId = req.ensureAnonymousId();
      const state = await getViewerState({
        anonymousId: req.anonymousId,
        variant,
        wordIds: targetKind === 'word' ? [targetId] : [],
        phonemeIds: targetKind === 'phoneme' ? [targetId] : [],
      });
      const current = (targetKind === 'word' ? state.words : state.phonemes)[String(targetId)];

      res.render('save-confirm', {
        title: current === 'unsaved' ? 'Save' : 'Remove from saved',
        targetKind,
        targetId,
        label: target.label,
        isSaved: current !== 'unsaved',
        // SDD §6.6: the token and a server-side CSPRNG idempotency key.
        ...issueConfirmationCredentials(config.csrf.secret, anonymousId),
        returnTo,
      });
    } catch (error) {
      next(error);
    }
  });

  // A script's request gets JSON errors; the confirmation form's gets the HTML
  // error page. Chosen first, so rate-limit and CSRF failures surface the same way.
  const markJsonUnlessForm = (req, res, next) =>
    req.is('application/x-www-form-urlencoded') ? next() : jsonErrorSurface()(req, res, next);

  router.post('/save', markJsonUnlessForm, saveRateLimit, requireCsrf(), async (req, res, next) => {
    const isForm = Boolean(req.is('application/x-www-form-urlencoded'));
    try {
      const input = parseSaveRequest(req.body);
      const outcome = await saveStateService.applySaveAction({ ...input, anonymousId: req.anonymousId });

      if (isForm) {
        res.redirect(303, safeReturnPath(req.body.returnTo));
        return;
      }
      res.json({ targetKind: outcome.targetKind, targetId: outcome.targetId, state: outcome.state });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
