/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * `POST /encounter` — one word encounter (FR-SAVE-10, FR-AUTH-20; SDD v1.1
 * §3.4, §6.6).
 *
 * Sent by the word page's script after hydration, only when hydration reports
 * the viewer's history as recorded. CSRF-verified on the frozen scheme and
 * rate-limited in the save/tag bucket (Appendix C). A viewer with no progress
 * profile, or a repeat on the same UTC day, gets `{ recorded: false }`, never an
 * error. The cached shell and the hydration read never write.
 */

import { Router } from 'express';

import { jsonErrorSurface, requireCsrf } from '../middleware/index.js';
import { parseEncounterRequest } from '../validators/progress.validator.js';

/**
 * @param {object} dependencies
 * @param {import('express').RequestHandler} dependencies.encounterRateLimit
 * @param {{ recordEncounter: Function }} dependencies.encounterService
 * @returns {import('express').Router}
 */
export function encounterRouter({ encounterRateLimit, encounterService }) {
  const router = Router();

  router.post('/encounter', jsonErrorSurface(), encounterRateLimit, requireCsrf(), async (req, res, next) => {
    try {
      const { wordId, idempotencyKey } = parseEncounterRequest(req.body);
      const { recorded } = await encounterService.recordEncounter({
        anonymousId: req.anonymousId,
        userId: req.session?.userId ?? null,
        wordId,
        idempotencyKey,
      });
      res.json({ recorded });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
