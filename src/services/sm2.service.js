/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SM-2 scheduling (FR-PRACTICE-04, SRS Round 4 Decisions: FR-PRACTICE-04).
 *
 * Pure: no I/O, no clock. One review in, the next state out. The same function
 * serves the live answer path and the replay that rebuilds an account's state
 * after a merge (SDD v1.1 §4.6), so there is exactly one SM-2.
 *
 * Self-assessment maps to quality: "right" → 5, "wrong" → 2. The standard SM-2
 * formulas then apply:
 *
 *   quality ≥ 3 (right):  interval 1 day, then 6 days, then round(interval × EF);
 *                         repetitions + 1
 *   quality < 3 (wrong):  repetitions → 0, interval → 1 day
 *   every review:         EF ← EF + (0.1 − (5 − q)(0.08 + (5 − q) × 0.02)),
 *                         never below 1.3
 *
 * The interval grows by the ease factor as it stood before this review. Due
 * dates are UTC and second precision (FR-PRACTICE-04).
 */

export const QUALITY = Object.freeze({ right: 5, wrong: 2 });

export const INITIAL_EASE_FACTOR = 2.5;
export const MINIMUM_EASE_FACTOR = 1.3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} Sm2State
 * @property {number} repetitionCount
 * @property {number} easeFactor three decimal places, as stored
 * @property {number} intervalDays
 */

/** The state of a word never practised: its first answer starts from here. */
export const INITIAL_SM2_STATE = Object.freeze({ repetitionCount: 0, easeFactor: INITIAL_EASE_FACTOR, intervalDays: 0 });

/** @param {number} value @returns {number} rounded to the DECIMAL(4,3) the column holds */
const toStoredEase = (value) => Math.round(value * 1000) / 1000;

/**
 * Apply one review.
 *
 * @param {Sm2State} state the state before this review
 * @param {number} quality 0–5; the product uses only 5 and 2
 * @returns {Sm2State}
 */
export function applySm2Review(state, quality) {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) throw new RangeError('SM-2 quality is an integer 0–5');

  let { repetitionCount, intervalDays } = state;
  if (quality >= 3) {
    intervalDays = repetitionCount === 0 ? 1 : repetitionCount === 1 ? 6 : Math.round(intervalDays * state.easeFactor);
    repetitionCount += 1;
  } else {
    repetitionCount = 0;
    intervalDays = 1;
  }

  const lapse = 5 - quality;
  const easeFactor = Math.max(
    MINIMUM_EASE_FACTOR,
    toStoredEase(state.easeFactor + (0.1 - lapse * (0.08 + lapse * 0.02))),
  );
  return { repetitionCount, easeFactor, intervalDays };
}

/**
 * When a word reviewed at `reviewedAt` is next due: `intervalDays` later, UTC,
 * truncated to the second.
 *
 * @param {Date} reviewedAt
 * @param {number} intervalDays
 * @returns {Date}
 */
export function nextDueAt(reviewedAt, intervalDays) {
  const due = reviewedAt.getTime() + intervalDays * DAY_MS;
  return new Date(Math.floor(due / 1000) * 1000);
}
