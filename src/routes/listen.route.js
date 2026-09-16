/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * `POST /listen` — one audio-listen event (FR-SAVE-09, FR-AUTH-20; SDD v1.1
 * §6.6).
 *
 * Sent by the page script when playback has actually started. CSRF-verified on
 * the frozen scheme and rate-limited in the save/tag bucket (Appendix C). A
 * viewer with no progress profile gets `{ recorded: false }`, never an error, so
 * playback is never made to depend on this request.
 */

import { Router } from 'express';

import { jsonErrorSurface, requireCsrf } from '../middleware/index.js';
import { recordListen } from '../services/listen.service.js';
import { parseListenRequest } from '../validators/progress.validator.js';

/**
 * @param {object} dependencies
 * @param {import('express').RequestHandler} dependencies.listenRateLimit
 * @returns {import('express').Router}
 */
export function listenRouter({ listenRateLimit }) {
  const router = Router();

  router.post('/listen', jsonErrorSurface(), listenRateLimit, requireCsrf(), async (req, res, next) => {
    try {
      const { targetKind, targetId } = parseListenRequest(req.body);
      res.json(await recordListen({ anonymousId: req.anonymousId, targetKind, targetId }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
