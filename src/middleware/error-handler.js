/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The single error middleware (SDD v1.1 §6.1, decision C2).
 *
 * One error type, one middleware, two surfaces. Every error terminates here.
 * The surface is selected from the route group the request entered — an EJS
 * error view for HTML page routes, a JSON object for the hydration endpoint and
 * other JSON routes — rather than by negotiating on the `Accept` header, which
 * would put a client-controlled branch in the error path.
 *
 * Only the safe message, the stable code, and the short correlation id reach
 * the user. The underlying cause and the stack are written to the log under
 * that same correlation id and are never serialised into the response.
 */

import { AppError, ERROR_CODES } from '../errors/index.js';
import { generateCorrelationId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

export const ERROR_SURFACE = Object.freeze({
  HTML: 'html',
  JSON: 'json',
});

/**
 * Mark a response as taking the JSON error surface.
 *
 * Apply this as ROUTE-level middleware — `router.get(path, jsonErrorSurface(),
 * handler)` — never as router-level `router.use(...)`. A router mounted without
 * a path prefix runs its `use` middleware for every request that reaches it,
 * including requests that go on to match an HTML page route or no route at all,
 * which would silently switch those responses to the JSON surface. Route-level
 * placement runs only when the request actually enters that route group, which
 * is what §6.1 specifies.
 *
 * @returns {import('express').RequestHandler}
 */
export function jsonErrorSurface() {
  return function markJsonErrorSurface(req, res, next) {
    res.locals.errorSurface = ERROR_SURFACE.JSON;
    next();
  };
}

/**
 * Terminal 404 handler for requests that matched no route. Placed after all
 * routers and before {@link errorHandler}, so an unmatched path travels the
 * same taxonomy as every other failure rather than falling through to Express's
 * default HTML page.
 *
 * @returns {import('express').RequestHandler}
 */
export function notFoundHandler() {
  return function handleUnmatchedRoute(req, res, next) {
    next(AppError.notFound());
  };
}

/**
 * Normalise anything thrown into an `AppError`. An error that is not already
 * typed is an unexpected failure and becomes a 500 whose cause is logged but
 * never surfaced.
 *
 * @param {unknown} thrown
 * @returns {AppError}
 */
function toAppError(thrown) {
  if (AppError.isAppError(thrown)) {
    return thrown;
  }
  // Express's own body-parser and routing errors carry a status; honour it
  // rather than reporting a client mistake as a server failure.
  const status = thrown?.status ?? thrown?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return AppError.validation('That request could not be processed.', { cause: thrown });
  }
  return AppError.internal(thrown);
}

/**
 * @returns {import('express').ErrorRequestHandler}
 */
export function errorHandler() {
  return function handleError(thrown, req, res, next) {
    const error = toAppError(thrown);
    // Never undefined: an error the user cannot quote back is an error nobody
    // can trace, so one is minted here if the context middleware did not run.
    const correlationId = res.locals.correlationId ?? req.id ?? generateCorrelationId();

    const logLine = {
      correlationId,
      code: error.code,
      status: error.status,
      method: req.method,
      url: req.originalUrl,
      err: error,
    };
    if (error.status >= 500) {
      logger.error(logLine, 'Request failed');
    } else {
      logger.warn(logLine, 'Request rejected');
    }

    // Headers already flushed: the response is committed, so hand back to
    // Express's default handler, which destroys the socket.
    if (res.headersSent) {
      next(thrown);
      return;
    }

    if (error.code === ERROR_CODES.RATE_LIMIT && error.meta?.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(error.meta.retryAfterSeconds));
    }

    res.status(error.status);

    if (res.locals.errorSurface === ERROR_SURFACE.JSON) {
      res.json({
        error: {
          code: error.code,
          message: error.message,
          correlationId,
        },
      });
      return;
    }

    res.render('errors/error', {
      status: error.status,
      code: error.code,
      message: error.message,
      correlationId,
    });
  };
}
