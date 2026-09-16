/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The per-viewer hydration read and the save write, from the browser (B2,
 * FR-SAVE-01, FR-SAVE-08, FR-AUTH-20; SDD v1.1 §3.4, §6.6).
 *
 * The page shell is identical for every viewer, so everything personal arrives
 * here: one `GET /viewer-state` for the targets on the page, which also returns
 * the CSRF token. Writes send that token in `X-CSRF-Token` with an idempotency
 * key from `crypto.getRandomValues`.
 *
 * This module reads `data-*` attributes only. It performs no IPA parsing.
 */

// Imported first so a restored `pa_uid` is in place before hydration runs.
import './bootstrap.js';

/** @type {Promise<object|null> | null} */
let hydration = null;
/** @type {string | null} */
let csrfToken = null;

/** @returns {string[]} unique numeric ids from the matching elements */
function idsOf(selector, attribute) {
  const ids = new Set();
  for (const element of document.querySelectorAll(selector)) {
    const id = element.getAttribute(attribute);
    if (id && /^[0-9]+$/.test(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * Hydrate once per page. Resolves to the state object, or null when the page has
 * nothing personal to show or the read failed.
 *
 * @returns {Promise<{ words: Record<string,string>, phonemes: Record<string,string>, learned: number, total: number } | null>}
 */
export function loadViewerState() {
  hydration ??= (async () => {
    const variant = document.querySelector('[data-viewer-variant]')?.getAttribute('data-viewer-variant');
    const words = idsOf('[data-save-control][data-target-kind="word"]', 'data-target-id');
    const phonemes = [
      ...new Set([
        ...idsOf('[data-save-control][data-target-kind="phoneme"]', 'data-target-id'),
        ...idsOf('.phoneme[data-phoneme-id]', 'data-phoneme-id'),
      ]),
    ];
    if (!variant) return null;

    const query = new URLSearchParams({ variant, words: words.join(','), phonemes: phonemes.join(',') });
    try {
      const response = await fetch(`/viewer-state?${query}`, { credentials: 'same-origin' });
      if (!response.ok) return null;
      const state = await response.json();
      csrfToken = state.csrfToken;
      return state;
    } catch {
      return null;
    }
  })();
  return hydration;
}

/** @returns {boolean} whether the browser kept the identity cookie (FR-SAVE-06) */
export function cookiesAvailable() {
  return document.cookie.split(';').some((part) => part.trim().startsWith('pa_uid='));
}

/** @returns {string} a URL-safe key with 192 bits from the browser CSPRNG */
function idempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Send one save or tag action.
 *
 * @param {{ targetKind: string, targetId: string, action: 'save'|'unsave'|'tag', tag?: 'none'|'learning'|'learned' }} change
 * @returns {Promise<string>} the resulting state
 */
export async function sendSaveAction(change) {
  await loadViewerState();
  if (!csrfToken) throw new Error('not hydrated');
  const response = await fetch('/save', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ ...change, targetId: Number(change.targetId), idempotencyKey: idempotencyKey() }),
  });
  if (!response.ok) throw new Error(`save failed: ${response.status}`);
  const result = await response.json();
  // A successful write means a progress profile now exists (FR-AUTH-03), so
  // this viewer's later listens are recorded without waiting for a reload.
  const state = await loadViewerState();
  if (state) state.recordsHistory = true;
  return result.state;
}

/**
 * Report one playback start (FR-SAVE-09). Sent only when hydration says this
 * viewer's history is recorded; a failure is swallowed, because a listen record
 * must never interfere with the audio itself.
 *
 * @param {'word'|'phoneme'} targetKind
 * @param {string} targetId
 * @returns {Promise<void>}
 */
export async function sendListen(targetKind, targetId) {
  const state = await loadViewerState();
  if (!state?.recordsHistory || !csrfToken) return;
  try {
    await fetch('/listen', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ targetKind, targetId: Number(targetId) }),
    });
  } catch {
    /* see above */
  }
}
