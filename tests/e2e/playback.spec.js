/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Playback speed, listen events and the convention label in a real browser
 * (FR-IPA-11, FR-SAVE-09, FR-WORD-03).
 *
 * A listen request must follow a playback that actually STARTED: a click whose
 * audio fails to load sends nothing, and a passive visitor sends nothing at all.
 * Requests to `/listen` are observed on the wire.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WORD = '/en-us/cupcake';

/** Collect the `/listen` requests a page sends. */
function recordListens(page) {
  const listens = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/listen') && request.method() === 'POST') {
      listens.push(request.postDataJSON());
    }
  });
  return listens;
}

/** Become an actor with progress, the only way one is made: save the word. */
async function saveWord(page) {
  const control = page.locator('button.save-control').first();
  await control.click();
  await expect(control).toHaveText('Saved');
}

test.describe('with JavaScript', () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'JavaScript flow');

  test('the speed toggle sets 0.75× and 1× on server audio', async ({ page }) => {
    await page.goto(WORD);
    const audio = page.locator('.pronunciation__audio audio').first();
    const toggle = page.locator('.pronunciation__audio .speed-toggle').first();

    await expect(toggle.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'true');
    await toggle.getByRole('button', { name: '0.75×' }).click();
    await expect(toggle.getByRole('button', { name: '0.75×' })).toHaveAttribute('aria-pressed', 'true');
    expect(await audio.evaluate((node) => node.playbackRate)).toBe(0.75);

    await toggle.getByRole('button', { name: '1×' }).click();
    expect(await audio.evaluate((node) => node.playbackRate)).toBe(1);
  });

  test('phoneme audio plays at the selected rate', async ({ page }) => {
    await page.addInitScript(() => {
      window.__rates = [];
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function play(...args) {
        const result = original.apply(this, args);
        this.addEventListener('playing', () => window.__rates.push(this.playbackRate), { once: true });
        return result;
      };
    });
    await page.goto(WORD);
    await page.locator('.pronunciation__audio .speed-toggle').first().getByRole('button', { name: '0.75×' }).click();
    await page.locator('.phoneme').first().click();
    await expect.poll(() => page.evaluate(() => window.__rates)).toEqual([0.75]);
  });

  test('Web Speech receives the selected rate', async ({ page }) => {
    await page.addInitScript(() => {
      window.__utterances = [];
      class FakeUtterance {
        constructor(text) {
          this.text = text;
          this.listeners = {};
        }

        addEventListener(type, handler) {
          this.listeners[type] = handler;
        }
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { cancel() {}, speak: (utterance) => window.__utterances.push({ text: utterance.text, rate: utterance.rate }) },
      });
    });
    await page.goto(WORD);
    await page.evaluate(() => {
      document.querySelector('.word').insertAdjacentHTML(
        'beforeend',
        '<p class="pronunciation__audio" id="tier3"><button type="button" class="pronunciation__speak" hidden data-speak="cupcake" data-lang="en-us" data-word-id="1">Play</button><span class="pronunciation__audio-status" role="status" hidden></span></p>',
      );
    });
    await page.evaluate(async () => (await import('/js/whole-word-audio.js')).enableWholeWordAudio());

    await page.locator('.speed-toggle').first().getByRole('button', { name: '0.75×' }).click();
    await page.locator('#tier3 .pronunciation__speak').click();
    expect(await page.evaluate(() => window.__utterances)).toEqual([{ text: 'cupcake', rate: 0.75 }]);
  });

  test('a passive visitor plays audio and sends no listen', async ({ page }) => {
    const listens = recordListens(page);
    await page.goto(WORD);
    await page.locator('.phoneme').first().click();
    await expect(page.locator('#phoneme-popover')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(listens).toEqual([]);
  });

  test('an actor with progress sends one listen per genuine start, including a replay', async ({ page }) => {
    const listens = recordListens(page);
    await page.goto(WORD);
    await saveWord(page);

    const first = page.locator('.phoneme').first();
    const id = Number(await first.getAttribute('data-phoneme-id'));
    await first.click();
    await expect.poll(() => listens.length).toBe(1);

    await page.locator('#phoneme-popover .phoneme-popover__replay').click();
    await expect.poll(() => listens.length).toBe(2);
    expect(listens).toEqual([
      { targetKind: 'phoneme', targetId: id },
      { targetKind: 'phoneme', targetId: id },
    ]);
  });

  test('a playback that fails to load sends no listen', async ({ page, browserName }) => {
    // WebKit loads media outside `page.route`, so the 404 below never applies
    // and the clip really plays; the failure cannot be staged there. The same
    // behaviour is asserted in Chromium and Firefox.
    test.skip(browserName === 'webkit', 'page.route does not intercept WebKit media requests');
    const listens = recordListens(page);
    await page.route('**/audio/**', (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto(WORD);
    await saveWord(page);

    await page.locator('.phoneme').first().click();
    await page.waitForTimeout(1500);
    expect(listens).toEqual([]);
  });

  test('the Broad en-US IPA help opens from the keyboard and passes axe-core', async ({ page }) => {
    await page.goto(WORD);
    const label = page.locator('.ipa-convention__label');
    const help = page.locator('.ipa-convention__help');
    await expect(label).toHaveText('Broad en-US IPA');
    await expect(help).toBeHidden();

    await label.focus();
    await page.keyboard.press('Enter');
    await expect(help).toBeVisible();
    await expect(help).toContainText('consistent learner-oriented phonemic transcription');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('without JavaScript', () => {
  test.skip(({ javaScriptEnabled }) => javaScriptEnabled, 'no-JavaScript flow');

  test('the convention label and its help work without JavaScript, and no speed toggle is shown', async ({ page }) => {
    await page.goto(WORD);
    await page.locator('.ipa-convention__label').click();
    await expect(page.locator('.ipa-convention__help')).toBeVisible();
    await expect(page.locator('.speed-toggle')).toHaveCount(0);
  });
});
