/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Request-scoped logging context (SDD v1.1 §6.2, decision C1).
 *
 * A correlation id is generated at the entry of every request and threaded into
 * the error taxonomy, so the safe error shown to a user and the detailed cause
 * recorded in the log share one identifier: a reported incident can be traced
 * to its log line without exposing the cause.
 *
 * Request bodies are never logged, and client IP addresses are deliberately
 * absent — those live in the Nginx access logs under their own retention
 * window (NFR-SEC-10, NFR-OPS-04).
 */

import pinoHttp from 'pino-http';

import { generateCorrelationId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

/**
 * @returns {import('express').RequestHandler}
 */
export function requestContextMiddleware() {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const id = generateCorrelationId();
      res.locals.correlationId = id;
      return id;
    },
    customLogLevel(req, res, error) {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // The default serialisers would attach headers and the body; only the
    // fields named here may be logged (§6.2).
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
