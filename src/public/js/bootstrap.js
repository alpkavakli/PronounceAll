/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Client-side bootstrap (FR-AUTH-02).
 *
 * Mirrors the current `pa_uid` cookie into `localStorage`, and rehydrates the
 * cookie from `localStorage` when the cookie is missing but the mirror
 * survives. This is the self-healing behaviour locked in Foundational
 * Decisions §6: a "clear cookies" tool that leaves `localStorage` intact does
 * not cost the visitor their saved progress.
 *
 * Plain ECMAScript modules, no framework, progressive enhancement only: every
 * reading feature on the site works with this file absent (§7.7).
 */

const COOKIE_NAME = 'pa_uid';
const STORAGE_KEY = 'pa_uid';
const MAX_AGE_SECONDS = 63072000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @returns {string | null} the current cookie value, when it is a valid UUID */
function readCookie() {
  const match = document.cookie.match(/(?:^|;\s*)pa_uid=([^;]*)/);
  const value = match ? decodeURIComponent(match[1]) : null;
  return value && UUID_V4.test(value) ? value : null;
}

/** @param {string} value */
function writeCookie(value) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Max-Age=${MAX_AGE_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
  ];
  if (window.location.protocol === 'https:') {
    attributes.push('Secure');
  }
  document.cookie = attributes.join('; ');
}

/** @returns {string | null} */
function readMirror() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && UUID_V4.test(value) ? value : null;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The site
    // still works; only the self-healing rehydration is lost.
    return null;
  }
}

/** @param {string} value */
function writeMirror(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* see readMirror */
  }
}

export function syncAnonymousIdentity() {
  const cookie = readCookie();
  const mirrored = readMirror();

  // The mirror is the durable identity and wins when the two disagree.
  //
  // FR-AUTH-02 describes the cookie as missing at this point, which is what
  // happens on a word page: the shell is the shared, edge-cached response and
  // carries no `Set-Cookie` (amended FR-AUTH-01, B2), so the server has not yet
  // issued anything when this script runs, and the restored value travels out
  // on the hydration request. On an uncached page the server issues a cookie on
  // the HTML response itself, so by the time this runs the cookie is present
  // but brand new — and preferring it would discard the visitor's real identity
  // and silently orphan their saved words, which is precisely the failure
  // FR-AUTH-02 exists to prevent. Preferring the mirror makes the requirement's
  // acceptance criterion hold on both paths.
  //
  // Clearing cookies AND localStorage still yields a new identity, as required.
  if (mirrored) {
    if (mirrored !== cookie) {
      // Rehydrate before any save, tag, or practice request runs, so the server
      // continues the existing anonymous profile rather than starting a new one.
      writeCookie(mirrored);
    }
    return mirrored;
  }

  if (cookie) {
    writeMirror(cookie);
    return cookie;
  }

  return null;
}

syncAnonymousIdentity();
