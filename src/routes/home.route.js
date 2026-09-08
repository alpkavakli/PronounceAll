/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The landing page. An HTML page route: it validates nothing yet, calls one
 * service, and renders (C4). It is dynamic rather than a cacheable shell — the
 * shell class belongs to the word page (B2), which arrives with Iteration 1.
 */

import { Router } from 'express';

import { listActiveVariants } from '../services/catalogue.service.js';

export function homeRouter() {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      res.render('home', { variants: await listActiveVariants() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
