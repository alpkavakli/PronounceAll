/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Health endpoint. A JSON route: thin, no business logic, taking the JSON error
 * surface (C4, §6.1). The probe is injected by the composition root, so this
 * module imports no infrastructure client (§7.3).
 */

import { Router } from 'express';

import { jsonErrorSurface } from '../middleware/error-handler.js';

/**
 * @param {object} deps
 * @param {() => Promise<{status: string, checks: object}>} deps.probeHealth
 * @returns {import('express').Router}
 */
export function healthRouter({ probeHealth }) {
  const router = Router();

  router.get('/health', jsonErrorSurface(), async (req, res, next) => {
    try {
      const report = await probeHealth();
      res.status(report.status === 'ok' ? 200 : 503).json(report);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
