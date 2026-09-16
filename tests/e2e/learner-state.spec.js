/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Learned phonemes, the progress banner, and `/learnIPA` progress in a real
 * browser (FR-IPA-02, FR-IPA-07, FR-WORD-06).
 *
 * Tagging a phoneme `learned` in the popover must turn every occurrence of it
 * learned — by class, underline cue and accessible name — move the banner to
 * its progress form, and show on `/learnIPA`. Each test uses a fresh context,
 * so a fresh identity with nothing learned.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WORD = '/en-us/cupcake';

/** Save and tag the first phoneme of the word learned, through the popover. */
async function learnFirstPhoneme(page) {
  await page.goto(WORD);
  const first = page.locator('.phoneme').first();
  await expect(first).toHaveClass(/phoneme--not-learned/);
  await first.click();
  const control = page.locator('#phoneme-popover button.save-control');
  await control.click();
  await expect(control).toHaveText('Saved');
  await control.click();
  await page.locator('.save-menu').getByRole('button', { name: 'Learned' }).click();
  await expect(control).toHaveText('Learned');
  return first;
}

test.describe('with JavaScript', () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'JavaScript flow');

  test('a fresh viewer sees every phoneme not yet learned and the invitation banner', async ({ page }) => {
    await page.goto(WORD);
    const first = page.locator('.phoneme').first();
    await expect(first).toHaveClass(/phoneme--not-learned/);
    await expect(first).toHaveAttribute('aria-label', /not learned yet$/);
    await expect(page.locator('[data-ipa-banner]')).toContainText('Learn every sound in English!');
  });

  test('tagging a phoneme learned marks every occurrence and moves the banner', async ({ page }) => {
    const first = await learnFirstPhoneme(page);
    const id = await first.getAttribute('data-phoneme-id');
    const occurrences = page.locator(`.phoneme[data-phoneme-id="${id}"]`);

    for (const occurrence of await occurrences.all()) {
      await expect(occurrence).toHaveClass(/phoneme--learned/);
      await expect(occurrence).toHaveAttribute('aria-label', /, learned$/);
    }
    const total = await page.locator('[data-ipa-banner]').getAttribute('data-total');
    await expect(page.locator('[data-ipa-banner]')).toHaveText(`1/${total} — doing great! ${Number(total) - 1} to go`);

    // The underline is the non-colour cue.
    const decoration = await first.evaluate((node) => getComputedStyle(node).textDecorationLine);
    expect(decoration).toContain('underline');
  });

  test('learnIPA shows the count, the learned row, and filters', async ({ page }) => {
    const first = await learnFirstPhoneme(page);
    const id = await first.getAttribute('data-phoneme-id');

    await page.goto('/en-us/learnIPA');
    const progress = page.locator('[data-learn-progress]');
    const total = await progress.getAttribute('data-total');
    await expect(progress).toHaveText(`1 / ${total} learned`);
    await expect(page.locator(`[data-learner-phoneme="${id}"]`)).toHaveClass(/phoneme--learned/);

    await page.locator('.learn-filter').getByRole('button', { name: 'Learned', exact: true }).click();
    await expect(page.locator('.phoneme-row:visible')).toHaveCount(1);
    await page.locator('.learn-filter').getByRole('button', { name: 'Not learned yet' }).click();
    await expect(page.locator('.phoneme-row:visible')).toHaveCount(Number(total) - 1);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('without JavaScript', () => {
  test.skip(({ javaScriptEnabled }) => javaScriptEnabled, 'no-JavaScript flow');

  test('the banner is the invitation and no progress or learner state is asserted', async ({ page }) => {
    await page.goto(WORD);
    await expect(page.locator('[data-ipa-banner]')).toContainText('Learn every sound in English!');
    await expect(page.locator('.phoneme--learned, .phoneme--not-learned')).toHaveCount(0);

    await page.goto('/en-us/learnIPA');
    await expect(page.locator('[data-learn-progress]')).toBeHidden();
  });
});
