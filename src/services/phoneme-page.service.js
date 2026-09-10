/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Read-side composition for the phoneme learning pages (FR-IPA-07, FR-IPA-10,
 * FR-IPA-08).
 *
 * Both pages are the same shape — a ranked list of canonical units, each with
 * its symbol, its example word, and its audio when there is any — so they share
 * one composition and differ only in scope.
 *
 * The ORDER is the requirement, not a presentation choice: FR-IPA-07's
 * acceptance criterion is that the rows equal `ORDER BY frequency_rank ASC`, so
 * the ordering belongs to the query and nothing here re-sorts it.
 *
 * What each row carries is fixed by FR-IPA-08: the example shown is the
 * `match_mode = 'sound'` row, chosen so the example demonstrates the SOUND
 * rather than a matching letter. The seed enforces that; this layer simply does
 * not second-guess it.
 */

import {
  listAllPhonemeDetails,
  listPhonemeDetails,
} from '../repositories/phonemes.repository.js';

/**
 * Shape one stored row for display.
 *
 * `hasAudio` is computed here rather than in the view so the rule lives in one
 * place: a control is offered only when a real, ready asset backs it. Every
 * phoneme asset is currently `pending`, so this is false throughout — which is
 * the honest state, not a bug.
 *
 * @param {object} row
 * @returns {object}
 */
function toDisplayRow(row) {
  return {
    phonemeId: row.phonemeId,
    ipaSymbol: row.ipaSymbol,
    frequencyRank: row.frequencyRank,
    variantCode: row.variantCode ?? null,
    variantName: row.variantName ?? null,
    exampleWord: row.exampleWord,
    examplePhonemicTranscription: row.examplePhonemicTranscription,
    exampleSourceReference: row.exampleSourceReference,
    audioStorageKey: row.audioStorageKey,
    hasAudio: Boolean(row.audioStorageKey),
  };
}

/**
 * One variant's inventory, ranked (FR-IPA-07).
 *
 * @param {object} variant the already-resolved active variant
 * @returns {Promise<object[]>}
 */
export async function listVariantInventory(variant) {
  const rows = await listPhonemeDetails(variant.variantId);
  return rows.map((row) => toDisplayRow({ ...row, variantCode: variant.code, variantName: variant.displayName }));
}

/**
 * Every active variant's inventory, ranked (FR-IPA-10).
 *
 * In v1.0 this equals the `en-us` set, because `en-us` is the only seeded
 * variant — exactly what that requirement's acceptance criterion says.
 *
 * @returns {Promise<object[]>}
 */
export async function listGlobalInventory() {
  return (await listAllPhonemeDetails()).map(toDisplayRow);
}
