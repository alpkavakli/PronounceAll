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

import { config } from '../config/index.js';
import { issueCsrfToken } from '../services/csrf.service.js';
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
      // SDD §6.6: the CSRF token is issued here, on the uncached per-viewer
      // response, bound to the identity this response carries — minted now if
      // the request had none, and set as `pa_uid` by the identity middleware.
      res.json({ ...state, csrfToken: issueCsrfToken(config.csrf.secret, req.ensureAnonymousId()) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
