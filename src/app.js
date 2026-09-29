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
import { createHibpChecker } from './lib/hibp.js';
import { createFlowSecretStore } from './lib/flow-secret-store.js';
import { createGoogleOidcClient } from './lib/google-oidc.js';
import { createSmtpMailer } from './lib/mailer.js';
import { hashPassword, verifyPassword } from './lib/passwords.js';
import { createSessionStore } from './lib/session-store.js';
import {
  anonymousIdentityMiddleware,
  retiredIdentityMiddleware,
  byAnonymousIdAndIp,
  byIp,
  contentSecurityPolicyMiddleware,
  cspNonceMiddleware,
  errorHandler,
  notFoundHandler,
  rateLimitMiddleware,
  RATE_LIMITS,
  requestContextMiddleware,
  responseClassMiddleware,
  securityHeadersMiddleware,
  sessionMiddleware,
} from './middleware/index.js';
import { accountEmailRouter } from './routes/account-email.route.js';
import { accountRouter } from './routes/account.route.js';
import { healthRouter } from './routes/health.route.js';
import { homeRouter } from './routes/home.route.js';
import { learnIpaRouter } from './routes/learn-ipa.route.js';
import { searchRouter } from './routes/search.route.js';
import { viewerStateRouter } from './routes/viewer-state.route.js';
import { encounterRouter } from './routes/encounter.route.js';
import { listenRouter } from './routes/listen.route.js';
import { saveRouter } from './routes/save.route.js';
import {
  createAccountEmailService,
  rateKeyForEmail,
  rateKeyForVerificationResend,
} from './services/account-email.service.js';
import { createAccountService, isRetiredAnonymousId } from './services/account.service.js';
import { createGoogleSignInService } from './services/google-sign-in.service.js';
import { createPasswordPolicy } from './services/password-policy.service.js';
import { createEncounterService } from './services/encounter.service.js';
import { createSessionService } from './services/session.service.js';
import { createSaveStateService } from './services/save-state.service.js';
import { createInMemoryIdempotencyStore, createRedisIdempotencyStore } from './lib/idempotency-store.js';
import { wordRouter } from './routes/word.route.js';
import { checkHealth } from './services/health.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express application.
 *
 * @param {object} [overrides] test seams for third parties; production passes none
 * @param {(password: string) => Promise<boolean>} [overrides.isBreachedPassword]
 *   replaces the HIBP range client (FR-AUTH-07)
 * @param {import('./lib/mailer.js').SendMail} [overrides.sendMail] replaces the
 *   SMTP adapter (FR-AUTH-09/11)
 * @param {import('./lib/google-oidc.js').GoogleOidcClient | null} [overrides.googleOidc]
 *   replaces the Google provider boundary (FR-AUTH-04a); null means not offered
 * @returns {import('express').Express}
 */
export function createApp({
  isBreachedPassword = createHibpChecker(),
  sendMail = createSmtpMailer(config.mail),
  googleOidc = config.google.isConfigured ? createGoogleOidcClient(config.google) : null,
} = {}) {
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

  // FR-SAVE-08 reservations share the NFR-SEC-11 store selection: Redis in
  // staging and production, in-memory only where the counters are too.
  const idempotencyStore =
    config.rateLimitStore === 'redis' ? createRedisIdempotencyStore() : createInMemoryIdempotencyStore();
  const saveStateService = createSaveStateService({ idempotencyStore });
  const encounterService = createEncounterService({ idempotencyStore });

  const verifyTurnstile = config.turnstile.isConfigured
    ? createTurnstileVerifier(config.turnstile.secretKey)
    : createUnconfiguredTurnstileVerifier();

  // Registered sessions are Redis-backed in every environment (V3).
  const sessionService = createSessionService({ store: createSessionStore() });
  const passwords = { hashPassword, verifyPassword };
  const passwordPolicy = createPasswordPolicy({ isBreachedPassword });
  const accountEmailService = createAccountEmailService({
    sendMail,
    // Links are absolute, on the configured public origin.
    links: {
      verification: (token) => `${config.baseUrl}/verify-email?token=${token}`,
      reset: (token) => `${config.baseUrl}/reset-password/confirm?token=${token}`,
    },
    passwords,
    passwordPolicy,
    sessionService,
    verifyTurnstile,
  });
  const accountService = createAccountService({
    verifyTurnstile,
    passwordPolicy,
    passwords,
    sessionService,
    accountEmailService,
  });
  const googleSignInService = googleOidc
    ? createGoogleSignInService({ google: googleOidc, secrets: createFlowSecretStore(), verifyTurnstile })
    : null;

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
  // SDD §5.1: a bound (retired) pa_uid is replaced wherever it is presented.
  app.use(retiredIdentityMiddleware({ isRetiredAnonymousId }));
  // The registered session (FR-AUTH-12), validated against the MySQL epoch (V3).
  app.use(sessionMiddleware({ sessionService }));

  // 6. Routes. The word router is mounted LAST of the routers, because its
  //    `/:variant` and `/:variant/:word` patterns would otherwise shadow the
  //    fixed paths above.
  app.use(healthRouter({ probeHealth: () => checkHealth({ pingDatabase, pingRedis }) }));
  app.use(homeRouter());
  // FIND-10, implemented ahead of the SRS. Top-level rather than
  // `/:variant/search`, which would be indistinguishable from a word lookup.
  app.use(searchRouter());
  // The B2 hydration read. Before the word router, whose `/:variant` pattern
  // would otherwise match `/viewer-state`.
  app.use(viewerStateRouter());
  // Before the word router, whose patterns would otherwise match `/save`.
  app.use(
    saveRouter({
      // Appendix C: save/tag POSTs, 60 per minute keyed on `pa_uid`.
      saveRateLimit: rateLimitMiddleware({ store: rateLimitStore, bucket: 'save-tag', ...RATE_LIMITS.SAVE_TAG }),
      saveStateService,
    }),
  );
  // FR-SAVE-09 listens share the save/tag rate-limit bucket (Appendix C).
  app.use(
    listenRouter({
      listenRateLimit: rateLimitMiddleware({ store: rateLimitStore, bucket: 'save-tag', ...RATE_LIMITS.SAVE_TAG }),
    }),
  );
  // FR-SAVE-10 encounters share the save/tag rate-limit bucket (Appendix C).
  app.use(
    encounterRouter({
      encounterRateLimit: rateLimitMiddleware({ store: rateLimitStore, bucket: 'save-tag', ...RATE_LIMITS.SAVE_TAG }),
      encounterService,
    }),
  );
  // Registration, sign-in and sign-out. Before the word router, whose
  // `/:variant` pattern would otherwise match `/login`.
  app.use(
    accountRouter({
      accountService,
      sessionService,
      googleSignInService,
      // Appendix C: 5 per 15 minutes per UUID + IP; 3 per hour per IP.
      loginRateLimit: rateLimitMiddleware({
        store: rateLimitStore,
        bucket: 'login',
        ...RATE_LIMITS.LOGIN,
        keyOf: byAnonymousIdAndIp,
      }),
      registerRateLimit: rateLimitMiddleware({
        store: rateLimitStore,
        bucket: 'register',
        ...RATE_LIMITS.REGISTER,
        keyOf: byIp,
      }),
    }),
  );
  // Email verification and password reset. Before the word router.
  app.use(
    accountEmailRouter({
      accountEmailService,
      // Appendix C: 3 per hour per account ID; 3 per hour per email address.
      resendRateLimit: rateLimitMiddleware({
        store: rateLimitStore,
        bucket: 'verify-resend',
        ...RATE_LIMITS.VERIFICATION_RESEND,
        keyOf: (req) => rateKeyForVerificationResend(req.body?.email),
      }),
      resetRateLimit: rateLimitMiddleware({
        store: rateLimitStore,
        bucket: 'password-reset',
        ...RATE_LIMITS.PASSWORD_RESET,
        keyOf: (req) => rateKeyForEmail(req.body?.email),
      }),
    }),
  );
  // MUST precede the word router. `/:variant/learnIPA` matches
  // `GET /:variant/:word` exactly, so registered the other way round the
  // learning page would be looked up as a word and 404. FR-IPA-07 fixes that
  // URL, so unlike /search the collision cannot be designed away — it is pinned
  // by a test instead.
  app.use(learnIpaRouter());
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
