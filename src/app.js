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
import {
  createInMemoryRateLimitStore,
  createRedisRateLimitStore,
} from './lib/rate-limit-store.js';
import { pingRedis } from './lib/redis.js';
import {
  createTurnstileVerifier,
  createUnconfiguredTurnstileVerifier,
} from './lib/turnstile.js';
import {
  anonymousIdentityMiddleware,
  contentSecurityPolicyMiddleware,
  cspNonceMiddleware,
  errorHandler,
  notFoundHandler,
  rateLimitMiddleware,
  RATE_LIMITS,
  requestContextMiddleware,
  responseClassMiddleware,
  securityHeadersMiddleware,
} from './middleware/index.js';
import { healthRouter } from './routes/health.route.js';
import { homeRouter } from './routes/home.route.js';
import { searchRouter } from './routes/search.route.js';
import { wordRouter } from './routes/word.route.js';
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

  // The Turnstile SITE key is public by design — it identifies the widget to
  // the browser. Only the SECRET key is a credential, and it never leaves the
  // server. Exposed through `app.locals` so any view can decide whether to
  // render the challenge (FR-WORD-05).
  app.locals.turnstileSiteKey = config.turnstile.isConfigured ? config.turnstile.siteKey : '';

  enforceUtcSessions(getPool());

  // Infrastructure adapters are constructed HERE and injected downwards, which
  // is what keeps the NFR-SEC-11 store selection and the FR-WORD-05 Turnstile
  // selection single decisions made once at boot rather than branches repeated
  // at every call site (C4).
  const rateLimitStore =
    config.rateLimitStore === 'redis'
      ? createRedisRateLimitStore()
      : createInMemoryRateLimitStore();

  const verifyTurnstile = config.turnstile.isConfigured
    ? createTurnstileVerifier(config.turnstile.secretKey)
    : createUnconfiguredTurnstileVerifier();

  // 1. Observability first, so every later failure carries a correlation id.
  app.use(requestContextMiddleware());

  // 2. Response classification, before anything that depends on the class.
  app.use(responseClassMiddleware());

  // 3. Security headers. The nonce is minted before the CSP that consumes it.
  app.use(cspNonceMiddleware());
  app.use(securityHeadersMiddleware());
  // The CSP is written at header-flush time, because its shape depends on the
  // response class the route selects later (amended NFR-SEC-03).
  app.use(contentSecurityPolicyMiddleware());

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

  // 4b. Audio assets (V4). Content-addressed and immutable, so they take the
  //     year-long immutable cache headers of §6.3 and are never invalidated —
  //     changed content is a new filename. Mounted with the other shared,
  //     cacheable assets, ahead of the identity middleware, so an audio
  //     response never carries a per-viewer `Set-Cookie`. In production Nginx
  //     serves this directory directly and Express never sees the request.
  app.use(
    config.audio.publicPrefix,
    express.static(config.audio.storageRoot, {
      index: false,
      fallthrough: false,
      immutable: true,
      maxAge: '1y',
    }),
  );

  // 5. Request parsing, then anonymous identity (FR-AUTH-01).
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(anonymousIdentityMiddleware());

  // 6. Routes. The word router is mounted LAST of the routers, because its
  //    `/:variant` and `/:variant/:word` patterns would otherwise shadow the
  //    fixed paths above.
  app.use(healthRouter({ probeHealth: () => checkHealth({ pingDatabase, pingRedis }) }));
  app.use(homeRouter());
  // FIND-10, implemented ahead of the SRS. Top-level rather than
  // `/:variant/search`, which would be indistinguishable from a word lookup.
  app.use(searchRouter());
  app.use(
    wordRouter({
      // Appendix C / Foundational Decisions §10.3: 10 per hour, keyed on the
      // `pa_uid` UUID.
      wordRequestRateLimit: rateLimitMiddleware({
        store: rateLimitStore,
        bucket: 'word-request',
        ...RATE_LIMITS.WORD_REQUEST,
      }),
      verifyTurnstile,
    }),
  );

  // 7. One terminal 404 and one error middleware (C2).
  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}

export default createApp;
