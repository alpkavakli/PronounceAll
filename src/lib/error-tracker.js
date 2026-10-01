/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Error tracking (NFR-OPS-03, NFR-PRIV-06, NFR-SEC-10; SDD v1.1 §6.1, §6.2;
 * Threat Model F5). Sentry, EU data region (maintainer decision 2026-10-01).
 *
 * What is sent is decided here, not by the SDK's defaults:
 *
 * - No default integrations and no OpenTelemetry setup, so the SDK collects
 *   no request, headers, cookies, body, IP address, user, breadcrumbs or
 *   traces on its own. Only what `report*` hands it is sent.
 * - A report carries the error's type, its (scrubbed) message and stack, the
 *   correlation id that the user also sees (§6.2), the stable error code, the
 *   HTTP method and the path without its query string.
 * - `beforeSend` scrubs every string that is left: email addresses, anything
 *   token-shaped, IP addresses, and a query string in a path. Defence in depth
 *   over the primary rule that nothing sensitive is handed over at all.
 *
 * With no DSN configured the tracker is a no-op, so development and tests send
 * nothing anywhere.
 */

import * as Sentry from '@sentry/node';

const EMAIL = /[^\s@<>"'()[\]]+@[^\s@<>"'()[\]]+\.[A-Za-z]{2,}/g;
/** Long runs of base64url/hex: session ids, tokens, hashes, nonces. */
const TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
/** Flat runs of hex digits and colons; a run with three or more colons is an IPv6 address. */
const HEX_COLON_RUN = /[0-9A-Fa-f:]{7,45}/g;
const maskIpv6 = (run) => (run.split(':').length > 3 ? '[ip]' : run);

/** @param {string} text */
export function scrubText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(EMAIL, '[email]')
    .replace(HEX_COLON_RUN, maskIpv6)
    .replace(IPV4, '[ip]')
    .replace(TOKEN, '[redacted]');
}

/** A path with its query string and fragment dropped, then scrubbed. */
export function scrubPath(path) {
  return typeof path === 'string' ? scrubText(path.split(/[?#]/)[0]) : undefined;
}

/**
 * The `beforeSend` backstop: keep the diagnostic shape, drop or mask the rest.
 *
 * @param {import('@sentry/node').ErrorEvent} event
 * @returns {import('@sentry/node').ErrorEvent}
 */
export function scrubEvent(event) {
  const method = event.request?.method;
  const path = scrubPath(event.request?.url);
  delete event.request;
  if (method || path) event.request = { method, url: path };
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.server_name;
  if (event.message) event.message = scrubText(event.message);
  if (event.logentry) {
    event.logentry = { message: scrubText(event.logentry.message) };
  }
  for (const exception of event.exception?.values ?? []) {
    exception.value = scrubText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
  return event;
}

/**
 * @typedef {object} ErrorTracker
 * @property {boolean} enabled
 * @property {(error: unknown, context: { correlationId?: string, code?: string, method?: string, path?: string }) => void} reportError
 * @property {(context: { status: number, method?: string, path?: string, correlationId?: string }) => void} reportResponse
 *   a 5xx response that no exception explains (e.g. a fail-closed dependency)
 * @property {(timeoutMs?: number) => Promise<boolean>} flush
 */

/** @type {ErrorTracker} The tracker with no DSN: reports nothing. */
export const disabledErrorTracker = Object.freeze({
  enabled: false,
  reportError() {},
  reportResponse() {},
  flush: async () => true,
});

/**
 * @param {object} options
 * @param {string} options.dsn empty: the tracker does nothing
 * @param {string} options.environment
 * @param {string} [options.release]
 * @param {string} [options.component] `web`, or the worker's name
 * @param {Function} [options.transport] tests capture envelopes with their own
 * @returns {ErrorTracker}
 */
export function createErrorTracker({ dsn, environment, release, component = 'web', transport }) {
  if (!dsn) return disabledErrorTracker;

  Sentry.init({
    dsn,
    environment,
    release,
    defaultIntegrations: false,
    integrations: [],
    skipOpenTelemetrySetup: true,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    initialScope: { tags: { component } },
    ...(transport ? { transport } : {}),
  });

  const request = ({ method, path }) => ({ method, url: scrubPath(path) });

  return {
    enabled: true,
    reportError(error, { correlationId, code, method, path } = {}) {
      Sentry.withScope((scope) => {
        if (correlationId) scope.setTag('correlation_id', correlationId);
        if (code) scope.setTag('code', code);
        scope.addEventProcessor((event) => ({ ...event, request: request({ method, path }) }));
        Sentry.captureException(error);
      });
    },
    reportResponse({ status, method, path, correlationId }) {
      Sentry.withScope((scope) => {
        if (correlationId) scope.setTag('correlation_id', correlationId);
        scope.setTag('status', String(status));
        scope.addEventProcessor((event) => ({ ...event, request: request({ method, path }) }));
        Sentry.captureMessage(`HTTP ${status} response`, 'error');
      });
    },
    flush: (timeoutMs = 2000) => Sentry.flush(timeoutMs),
  };
}
