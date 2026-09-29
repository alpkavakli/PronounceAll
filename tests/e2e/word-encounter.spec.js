/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word encounters in a real browser (FR-SAVE-10).
 *
 * The page sends `POST /encounter` after hydration, only for a viewer whose
 * history was already recorded when the page opened, and the request carries
 * the canonical word id and an idempotency key — nothing else. Requests are
 * observed on the wire.
 */

import { expect, test } from '@playwright/test';

/**
 * Collect the `/encounter` requests a page sends, with each response status.
 * Only the status: the page never reads the answer's body, and Chromium does not
 * reliably expose an unread body to the test.
 */
function recordEncounters(page) {
  const encounters = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/encounter') && request.method() === 'POST') {
      const entry = { body: request.postDataJSON(), status: undefined };
      encounters.push(entry);
      request
        .response()
        .then((response) => {
          entry.status = response?.status();
        })
        .catch(() => {});
    }
  });
  return encounters;
}

/**
 * Send the same encounter again from inside the page, as the page's own script
 * would, and return the server's answer: `{ recorded: false }` proves the
 * browser's own request was stored for today.
 */
function encounterAgain(page, wordId) {
  return page.evaluate(async (id) => {
    const variant = document.querySelector('[data-viewer-variant]').getAttribute('data-viewer-variant');
    const { csrfToken } = await (await fetch(`/viewer-state?variant=${variant}`)).json();
    const response = await fetch('/encounter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ wordId: id, idempotencyKey: crypto.randomUUID().replaceAll('-', '') }),
    });
    return response.json();
  }, wordId);
}

/** Open a word page and wait until hydration has answered. */
async function openWord(page, path) {
  const hydrated = page.waitForResponse((response) => response.url().includes('/viewer-state'));
  await page.goto(path);
  await hydrated;
}

test.describe('with JavaScript', () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'JavaScript flow');

  test('a passive reader sends no encounter', async ({ page }) => {
    const encounters = recordEncounters(page);
    await openWord(page, '/en-us/cupcake');
    await openWord(page, '/en-us/beauty');
    await page.waitForTimeout(500);

    expect(encounters).toEqual([]);
  });

  test('a learner with progress records the word once per day, and only the word id is sent', async ({ page }) => {
    const encounters = recordEncounters(page);

    // The first save creates the profile mid-visit. An encounter before the
    // profile existed is never reconstructed, so this visit sends none.
    await openWord(page, '/en-us/cupcake');
    const control = page.locator('button.save-control').first();
    await control.click();
    await expect(control).toHaveText('Saved');
    await page.waitForTimeout(500);
    expect(encounters).toEqual([]);

    await openWord(page, '/en-us/beauty');
    await expect.poll(() => encounters.length).toBe(1);
    const wordId = Number(await page.locator('[data-encounter-word]').getAttribute('data-encounter-word'));
    expect(Object.keys(encounters[0].body).sort()).toEqual(['idempotencyKey', 'wordId']);
    expect(encounters[0].body.wordId).toBe(wordId);
    // Accepted: the token and origin a real browser sends pass verification.
    await expect.poll(() => encounters[0].status).toBe(200);

    // Stored for today: the same word again the same day is a no-op. (This
    // request is observed by the recorder too, hence the count below.)
    expect(await encounterAgain(page, wordId)).toEqual({ recorded: false });
    await expect.poll(() => encounters.length).toBe(2);

    // Reopening the page still sends one, and it is accepted as the no-op.
    await openWord(page, '/en-us/beauty');
    await expect.poll(() => encounters.length).toBe(3);
    await expect.poll(() => encounters[2].status).toBe(200);
  });
});

test('without JavaScript nothing is recorded', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const encounters = recordEncounters(page);

  await page.goto('/en-us/cupcake');
  await expect(page.locator('[data-encounter-word]')).toHaveCount(1);
  expect(encounters).toEqual([]);

  await context.close();
});
