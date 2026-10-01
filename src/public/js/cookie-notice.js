/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The strictly-necessary cookie acknowledgement (FR-CONSENT-01).
 *
 * An acknowledgement, not a consent request: one affordance, "OK, got it",
 * which writes `pa_uid_ack=1` to localStorage and hides the notice for good.
 * No cookie is used. Without JavaScript, or with storage unavailable, the
 * notice simply stays — the safe side of a notice.
 */

const KEY = 'pa_uid_ack';

const notice = document.querySelector('[data-cookie-notice]');
const ok = notice?.querySelector('[data-cookie-notice-ok]');

function acknowledged() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

if (notice && ok) {
  if (acknowledged()) {
    notice.hidden = true;
  } else {
    ok.hidden = false;
    ok.addEventListener('click', () => {
      try {
        window.localStorage.setItem(KEY, '1');
      } catch {
        // Hidden for this page only.
      }
      notice.hidden = true;
    });
  }
}
