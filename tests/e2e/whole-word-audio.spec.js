/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * FR-IPA-05 tier 3 in a real browser.
 *
 * Two of FR-IPA-05's acceptance criteria can only be checked with a browser:
 * that activating the control invokes `window.speechSynthesis.speak` when both
 * server-side sources are unavailable, and that a total failure produces a
 * VISIBLE indicator rather than a silent nothing.
 *
 * Which pronunciations have a server-side asset depends on whether the word TTS
 * batch has run, and the e2e suite has no database access, so these tests drive
 * the real client module over the exact markup the server emits for a word with
 * no asset. `enableWholeWordAudio` is exported for precisely this: the module's
 * contract — reveal only where the browser can speak, speak on activation,
 * announce when it cannot — is what is under test, not the server's choice of
 * when to emit the button, which `tests/integration/whole-word-audio.test.js`
 * covers directly.
 */

import { expect, test } from '@playwright/test';

const WORD_URL = '/en-us/cupcake';

/** The markup `word.ejs` emits for a primary pronunciation with no asset. */
const MARKUP = `
  <p class="pronunciation__audio" id="tier3">
    <button type="button" class="pronunciation__speak" hidden data-speak="cupcake" data-lang="en-us">
      Play <span class="visually-hidden">cupcake</span>
    </button>
    <span class="pronunciation__audio-status" role="status" hidden></span>
  </p>
`;

/**
 * Replace speechSynthesis with a recorder before any page script runs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{failing?: boolean}} options
 */
async function stubSpeech(page, { failing = false } = {}) {
  await page.addInitScript((shouldFail) => {
    window.__spoken = [];
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.listeners = {};
      }

      addEventListener(type, handler) {
        this.listeners[type] = handler;
      }
    }
    // `speechSynthesis` is an accessor on the Window prototype, so a plain
    // assignment fails silently and the REAL engine stays in place — which
    // makes the stub look installed while the test measures nothing.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance) {
          window.__spoken.push(utterance.text);
          if (shouldFail) {
            // The engine accepts the utterance and then fails, which is the
            // real shape of a Web Speech failure.
            utterance.listeners.error?.(new Event('error'));
          }
        },
      },
    });
  }, failing);
}

/** Insert the no-asset markup and run the real module over it. */
async function mountTier3(page) {
  await page.evaluate((markup) => {
    document.querySelector('.word').insertAdjacentHTML('beforeend', markup);
  }, MARKUP);
  await page.evaluate(async () => {
    const module = await import('/js/whole-word-audio.js');
    module.enableWholeWordAudio();
  });
}

test.describe('FR-IPA-05 tier 3 — the Web Speech fallback', () => {
  test.skip(
    ({ javaScriptEnabled }) => !javaScriptEnabled,
    'Tier 3 is a JavaScript enhancement; tiers 1 and 2 carry the no-JS path.',
  );

  test('the control is revealed when the browser can speak', async ({ page }) => {
    await stubSpeech(page);
    await page.goto(WORD_URL);
    await mountTier3(page);

    await expect(page.locator('#tier3 .pronunciation__speak')).toBeVisible();
  });

  test('activating it invokes speechSynthesis.speak with the word', async ({ page }) => {
    await stubSpeech(page);
    await page.goto(WORD_URL);
    await mountTier3(page);

    await page.locator('#tier3 .pronunciation__speak').click();

    expect(await page.evaluate(() => window.__spoken)).toEqual(['cupcake']);
  });

  test('a failure shows a visible indicator rather than failing silently', async ({ page }) => {
    await stubSpeech(page, { failing: true });
    await page.goto(WORD_URL);
    await mountTier3(page);

    await page.locator('#tier3 .pronunciation__speak').click();

    const status = page.locator('#tier3 .pronunciation__audio-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText(/unavailable/i);
  });

  test('the control stays hidden when the browser cannot speak at all', async ({ page }) => {
    await page.addInitScript(() => {
      // Some browsers expose neither; the control must not appear. Redefining
      // to undefined is what actually removes an inherited accessor — `delete`
      // on the prototype's property does not.
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
    });
    await page.goto(WORD_URL);
    await mountTier3(page);

    await expect(page.locator('#tier3 .pronunciation__speak')).toBeHidden();
  });
});
