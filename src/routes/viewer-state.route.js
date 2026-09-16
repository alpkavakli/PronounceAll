/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The hydration endpoint (B2; SDD v1.1 §3.4, §5.3, §6.3).
 *
 * `GET /viewer-state?variant=en-us&words=…&phonemes=…` returns the viewer's
 * save state for the listed targets and the FR-WORD-06 learned count. It is the
 * uncached, per-viewer half of the page: `Cache-Control: private, no-store`,
 * JSON errors, and the response that issues and slides `pa_uid` (amended
 * FR-AUTH-01). It never writes.
 *
 * Registered before the word router, whose `/:variant` pattern would otherwise
 * match `/viewer-state`.
 */

import { Router } from 'express';

import { jsonErrorSurface, markHydration } from '../middleware/index.js';
import { parseViewerStateQuery } from '../validators/progress.validator.js';
import { getViewerState } from '../services/viewer-state.service.js';
import { requireActiveVariant } from '../services/word-page.service.js';

/**
 * @returns {import('express').Router}
 */
export function viewerStateRouter() {
  const router = Router();

  router.get('/viewer-state', jsonErrorSurface(), async (req, res, next) => {
    try {
      markHydration(res);
      const { variantCode, wordIds, phonemeIds } = parseViewerStateQuery(req.query);
      const variant = await requireActiveVariant(variantCode);
      const state = await getViewerState({ anonymousId: req.anonymousId, variant, wordIds, phonemeIds });
      res.json(state);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
