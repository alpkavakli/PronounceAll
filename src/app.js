/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The composition root (SDD v1.1 §3.3, §7.1, decision C4).
 *
 * This is the one module that knows about every layer at once: it constructs
 * the shared infrastructure clients, wires them into services, hands services
 * to routers, and assembles the middleware pipeline. Nothing below this file
 * imports across a layer boundary it is not allowed to cross.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import express from 'express';

import { config } from './config/index.js';
import { enforceUtcSessions, getPool, pingDatabase } from './lib/mysql.js';
import { pingRedis } from './lib/redis.js';
import {
  anonymousIdentityMiddleware,
  cspNonceMiddleware,
  errorHandler,
  notFoundHandler,
  requestContextMiddleware,
  responseClassMiddleware,
  securityHeadersMiddleware,
} from './middleware/index.js';
import { healthRouter } from './routes/health.route.js';
import { homeRouter } from './routes/home.route.js';
import { checkHealth } from './services/health.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express application.
 *
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // Cloudflare and Nginx sit in front in production; the hop count is
  // configured rather than assumed, so `req.protocol` and `req.ip` are honest
  // without blindly trusting a forwarded header.
  app.set('trust proxy', config.trustProxyHops);
  app.set('view engine', 'ejs');
  app.set('views', path.join(here, 'views'));
  app.disable('x-powered-by');

  enforceUtcSessions(getPool());

  // 1. Observability first, so every later failure carries a correlation id.
  app.use(requestContextMiddleware());

  // 2. Response classification, before anything that depends on the class.
  app.use(responseClassMiddleware());

  // 3. Security headers. The nonce is minted before the CSP that consumes it.
  app.use(cspNonceMiddleware());
  app.use(securityHeadersMiddleware());

  // 4. Static assets. Mounted ahead of the identity middleware so a shared,
  //    cacheable asset response never carries a per-viewer `Set-Cookie`.
  //    In production Nginx serves these directly from disk and Express never
  //    sees the request.
  app.use(
    express.static(path.join(here, 'public'), {
      index: false,
      maxAge: config.isProductionLike ? '1y' : 0,
      immutable: config.isProductionLike,
    }),
  );

  // 5. Request parsing, then anonymous identity (FR-AUTH-01).
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(anonymousIdentityMiddleware());

  // 6. Routes.
  app.use(healthRouter({ probeHealth: () => checkHealth({ pingDatabase, pingRedis }) }));
  app.use(homeRouter());

  // 7. One terminal 404 and one error middleware (C2).
  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}

export default createApp;
