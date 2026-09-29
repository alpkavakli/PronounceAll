/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The per-viewer hydration read (B2, FR-SAVE-01, FR-WORD-06; SDD v1.1 §3.4).
 *
 * The cached shell is identical for every viewer; this read supplies what is
 * not: the viewer's save state for the words and phonemes on a page, and the
 * learned-phoneme count for the variant. It is a READ. It never creates an
 * `anonymous_profiles` row (FR-AUTH-03) and never writes an event.
 *
 * A viewer with no profile has, by definition, nothing saved: every target is
 * `unsaved` and the learned count is zero, answered without querying state.
 */

import {
  anonymousProfileExists,
  countLearnedPhonemes,
  findBoundUserId,
  findTargetLabel,
  findTargetStates,
} from '../repositories/progress.repository.js';
import { countPhonemes } from '../repositories/phonemes.repository.js';

/** A page asks about at most this many targets of one kind. */
export const MAX_TARGETS_PER_KIND = 200;

/**
 * @param {Map<number, string>} states
 * @param {number[]} ids
 * @returns {Record<string, string>} every requested id, defaulting to `unsaved`
 */
function withDefaults(states, ids) {
  return Object.fromEntries(ids.map((id) => [String(id), states.get(id) ?? 'unsaved']));
}

/**
 * @param {object} request
 * @param {string|null} request.anonymousId the viewer's `pa_uid`, if carried
 * @param {number|null} [request.userId] the signed-in user, whose state this is
 * @param {{ variantId: number }} request.variant
 * @param {number[]} request.wordIds
 * @param {number[]} request.phonemeIds
 * @returns {Promise<{ words: Record<string,string>, phonemes: Record<string,string>, learned: number, total: number, recordsHistory: boolean }>}
 *   `recordsHistory` says whether this viewer's listens and word encounters are recorded (FR-SAVE-09, FR-SAVE-10: a registered user, or a progress profile exists), so the page need not send a request that would be a no-op
 */
export async function getViewerState({ anonymousId, userId = null, variant, wordIds, phonemeIds }) {
  const total = await countPhonemes(variant.variantId);

  if (userId === null && (!anonymousId || !(await anonymousProfileExists(anonymousId)))) {
    return {
      words: withDefaults(new Map(), wordIds),
      phonemes: withDefaults(new Map(), phonemeIds),
      learned: 0,
      total,
      recordsHistory: false,
    };
  }

  const ownerUserId = userId ?? (await findBoundUserId(anonymousId));
  const owner = ownerUserId === null ? { anonymousId } : { userId: ownerUserId };

  const [words, phonemes, learned] = await Promise.all([
    findTargetStates(owner, 'word', wordIds),
    findTargetStates(owner, 'phoneme', phonemeIds),
    countLearnedPhonemes(owner, variant.variantId),
  ]);

  return {
    words: withDefaults(words, wordIds),
    phonemes: withDefaults(phonemes, phonemeIds),
    learned,
    total,
    recordsHistory: true,
  };
}

/**
 * Name a save target for a person: a word's headword or a phoneme's symbol,
 * with its variant code.
 *
 * @param {'word'|'phoneme'} targetKind
 * @param {number} targetId
 * @returns {Promise<{ label: string, variantCode: string } | null>}
 */
export function describeTarget(targetKind, targetId) {
  return findTargetLabel(targetKind, targetId);
}
