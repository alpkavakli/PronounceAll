/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Practice (FR-PRACTICE-01/03/04/05/06; SDD v1.1 §5.4).
 *
 *   GET  /practice               the current state: nothing saved, nothing due
 *                                (with ?upcoming=1, the read-only schedule), or
 *                                the served turn; ?done=<id> adds the summary of
 *                                a session just completed
 *   POST /practice/attempt       CSRF → one answer to the served turn → 303 back
 *
 * Server-rendered, one turn per page, so practice works without JavaScript;
 * the audio and phoneme controls are the word page's own, enhanced by the same
 * scripts. DYNAMIC (private, no-store).
 */

import { Router } from 'express';

import { config } from '../config/index.js';
import { csrfTokenFor, requireCsrf } from '../middleware/index.js';
import { findPracticeWordLocation, practiceOwnerOf } from '../services/practice.service.js';
import { getWordPage, requireActiveVariant } from '../services/word-page.service.js';
import { parsePracticeAnswer } from '../validators/practice.validator.js';

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../services/practice.service.js').createPracticeService>} dependencies.practiceService
 * @returns {import('express').Router}
 */
export function practiceRouter({ practiceService }) {
  const router = Router();

  const ownerOf = (req) => practiceOwnerOf({ userId: req.session?.userId ?? null, anonymousId: req.anonymousId });

  router.get('/practice', async (req, res, next) => {
    try {
      const owner = ownerOf(req);
      const doneId = Number.parseInt(String(req.query.done ?? ''), 10);
      const summary = Number.isSafeInteger(doneId) ? await practiceService.summary(owner, doneId) : null;
      const state = await practiceService.enter(owner);

      const view = { title: 'Practice my saved words', state, summary, upcoming: null, turn: null, csrfToken: null };

      if (state.kind === 'none-due' && req.query.upcoming === '1') {
        view.upcoming = await practiceService.upcoming(owner);
      }
      if (state.kind === 'turn') {
        const location = await findPracticeWordLocation(state.wordId);
        const variant = await requireActiveVariant(location.variantCode);
        const page = await getWordPage(variant, location.slug);
        view.turn = { ...state, variant, word: page.word, pronunciations: page.pronunciations };
        view.csrfToken = csrfTokenFor(req);
        view.audioPublicPrefix = config.audio.publicPrefix;
      }
      res.render('practice', view);
    } catch (error) {
      next(error);
    }
  });

  router.post('/practice/attempt', requireCsrf(), async (req, res, next) => {
    try {
      const outcome = await practiceService.answer(ownerOf(req), parsePracticeAnswer(req.body));
      res.redirect(303, outcome.kind === 'complete' ? `/practice?done=${outcome.sessionId}` : '/practice');
    } catch (error) {
      next(error);
    }
  });

  return router;
}
