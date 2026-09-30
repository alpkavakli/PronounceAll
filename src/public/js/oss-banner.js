/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The open-source banner's dismissal (FR-OSS-02).
 *
 * Closing it writes `pa_oss_dismissed_until` = now + 30 minutes to localStorage;
 * until then every page hides it, and afterwards it returns on the next page
 * load. No cookie is used. Storage that is unavailable simply means the banner
 * stays, which is the safe side of a notice.
 */

const KEY = 'pa_oss_dismissed_until';
const DISMISS_MS = 30 * 60 * 1000;

const banner = document.querySelector('[data-oss-banner]');
const close = banner?.querySelector('[data-oss-banner-close]');

function dismissedUntil() {
  try {
    return Number(window.localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

if (banner && close) {
  if (Date.now() < dismissedUntil()) {
    banner.hidden = true;
  } else {
    close.hidden = false;
    close.addEventListener('click', () => {
      try {
        window.localStorage.setItem(KEY, String(Date.now() + DISMISS_MS));
      } catch {
        // Hidden for this page only.
      }
      banner.hidden = true;
    });
  }
}
