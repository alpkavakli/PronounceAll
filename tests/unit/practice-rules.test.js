/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SM-2 (FR-PRACTICE-04) and the practice queue's rules (FR-PRACTICE-02/05/06),
 * with a seeded generator so every random choice is reproducible.
 */

import { describe, expect, test } from '@jest/globals';

import {
  advance,
  chooseServed,
  createQueue,
  isFinished,
  reinsertionIndex,
} from '../../src/services/practice-queue.service.js';
import {
  applySm2Review,
  INITIAL_SM2_STATE,
  MINIMUM_EASE_FACTOR,
  nextDueAt,
  QUALITY,
} from '../../src/services/sm2.service.js';

/** mulberry32: a small, well-known seeded PRNG for tests. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('FR-PRACTICE-04 — SM-2', () => {
  test('right is quality 5 and wrong is quality 2', () => {
    expect(QUALITY).toEqual({ right: 5, wrong: 2 });
  });

  test('the first correct review: 1 day, one repetition, ease up by 0.1', () => {
    expect(applySm2Review(INITIAL_SM2_STATE, 5)).toEqual({ repetitionCount: 1, easeFactor: 2.6, intervalDays: 1 });
  });

  test('each later correct review: 6 days, then interval × the ease before the review', () => {
    const first = applySm2Review(INITIAL_SM2_STATE, 5);
    const second = applySm2Review(first, 5);
    expect(second).toEqual({ repetitionCount: 2, easeFactor: 2.7, intervalDays: 6 });
    const third = applySm2Review(second, 5);
    expect(third).toEqual({ repetitionCount: 3, easeFactor: 2.8, intervalDays: 16 }); // round(6 × 2.7)
    const fourth = applySm2Review(third, 5);
    expect(fourth).toEqual({ repetitionCount: 4, easeFactor: 2.9, intervalDays: 45 }); // round(16 × 2.8)
  });

  test.each([0, 1, 2, 3, 5])('a wrong review at repetition %i resets to 1 day and 0 repetitions, ease down 0.32', (reps) => {
    let state = INITIAL_SM2_STATE;
    for (let index = 0; index < reps; index += 1) state = applySm2Review(state, 5);
    const after = applySm2Review(state, 2);
    expect(after.repetitionCount).toBe(0);
    expect(after.intervalDays).toBe(1);
    expect(after.easeFactor).toBeCloseTo(Math.max(1.3, state.easeFactor - 0.32), 3);
  });

  test('the ease factor never drops below 1.3', () => {
    let state = INITIAL_SM2_STATE;
    for (let index = 0; index < 20; index += 1) {
      state = applySm2Review(state, 2);
      expect(state.easeFactor).toBeGreaterThanOrEqual(MINIMUM_EASE_FACTOR);
    }
    expect(state.easeFactor).toBe(MINIMUM_EASE_FACTOR);
    // And recovery after the floor restarts the interval ladder.
    expect(applySm2Review(state, 5)).toEqual({ repetitionCount: 1, easeFactor: 1.4, intervalDays: 1 });
  });

  test('due dates are UTC, second precision, interval days later', () => {
    const reviewed = new Date('2026-09-30T23:59:59.789Z');
    expect(nextDueAt(reviewed, 6).toISOString()).toBe('2026-10-06T23:59:59.000Z');
  });

  test('a quality outside 0–5 is refused', () => {
    expect(() => applySm2Review(INITIAL_SM2_STATE, 6)).toThrow(RangeError);
  });
});

const words = (tags) => tags.map((tag, index) => ({ wordId: index + 1, tag }));

describe('FR-PRACTICE-05 — wrong-answer reinsertion', () => {
  test('a seeded generator gives an offset in [3, 7], and every offset occurs', () => {
    const rng = seeded(42);
    const queue = createQueue(words(Array(20).fill('saved')));
    const seen = new Set();
    for (let draw = 0; draw < 500; draw += 1) {
      const offset = reinsertionIndex(queue, rng) - queue.position;
      expect(offset).toBeGreaterThanOrEqual(3);
      expect(offset).toBeLessThanOrEqual(7);
      seen.add(offset);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  test('the same seed reproduces the same offsets', () => {
    const queue = createQueue(words(Array(20).fill('saved')));
    const draws = (seed) => {
      const rng = seeded(seed);
      return Array.from({ length: 10 }, () => reinsertionIndex(queue, rng));
    };
    expect(draws(7)).toEqual(draws(7));
  });

  test('with fewer than 3 slots left the word goes to the tail', () => {
    const queue = { ...createQueue(words(['saved', 'saved', 'saved'])), position: 1 };
    expect(reinsertionIndex(queue, () => 0)).toBe(3);
    expect(reinsertionIndex(queue, () => 0.99)).toBe(3);
  });

  test('a wrong answer puts the word back to be served again; a right one does not', () => {
    const rng = seeded(1);
    let queue = createQueue(words(['saved', 'saved', 'saved', 'saved', 'saved', 'saved']));
    queue = advance(queue, 'wrong', rng);
    expect(queue.entries).toHaveLength(7);
    expect(queue.entries.filter((entry) => entry.wordId === 1)).toHaveLength(2);
    queue = advance(queue, 'right', rng);
    expect(queue.entries).toHaveLength(7);
  });

  test('the session ends only when every word was answered and no reinsertion is pending', () => {
    const rng = seeded(3);
    let queue = createQueue(words(['saved', 'saved']));
    queue = advance(queue, 'wrong', rng); // word 1 returns at the tail
    queue = advance(queue, 'right', rng);
    expect(isFinished(queue)).toBe(false);
    expect(queue.entries[queue.position].wordId).toBe(1);
    queue = advance(queue, 'right', rng);
    expect(isFinished(queue)).toBe(true);
    expect(queue.turnSeq).toBe(3);
  });
});

describe('FR-PRACTICE-02 — learned words at half frequency', () => {
  test('a learned head with a non-learned alternative is deferred exactly when rng < 0.5', () => {
    const queue = createQueue(words(['learned', 'saved']));
    expect(chooseServed(queue, () => 0.49).entries.map((entry) => entry.wordId)).toEqual([2, 1]);
    expect(chooseServed(queue, () => 0.5).entries.map((entry) => entry.wordId)).toEqual([1, 2]);
  });

  test('never deferred when every remaining word is learned, and non-learned heads are untouched', () => {
    expect(chooseServed(createQueue(words(['learned', 'learned'])), () => 0).entries[0].wordId).toBe(1);
    expect(chooseServed(createQueue(words(['learning', 'learned'])), () => 0).entries[0].wordId).toBe(1);
  });

  test('deferral moves the learned word only to the next slot, and nothing is lost', () => {
    const queue = createQueue(words(['learned', 'learned', 'saved', 'learning']));
    const served = chooseServed(queue, () => 0);
    expect(served.entries.map((entry) => entry.wordId)).toEqual([3, 1, 2, 4]);
  });

  test('seeded and deterministic: the same seed gives the same serving order', () => {
    const order = (seed) => {
      const rng = seeded(seed);
      let queue = createQueue(words(['learned', 'saved', 'learned', 'learning', 'learned', 'saved']));
      const served = [];
      while (!isFinished(queue)) {
        queue = chooseServed(queue, rng);
        served.push(queue.entries[queue.position].wordId);
        queue = advance(queue, 'right', rng);
      }
      return served;
    };
    expect(order(11)).toEqual(order(11));
    // Every due word is still served exactly once.
    expect([...order(11)].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('over ≥ 1 000 turns a learned word is served at 0.5 ± 0.05 of the rate a non-learned one would be', () => {
    // Each opportunity: a learned word is at the head and a non-learned
    // alternative is available. Serving the learned word there is the event
    // the requirement halves.
    const rng = seeded(2026);
    let opportunities = 0;
    let learnedServed = 0;
    for (let turn = 0; turn < 4000; turn += 1) {
      const tags = Array.from({ length: 6 }, () => (rng() < 0.5 ? 'learned' : 'saved'));
      tags[0] = 'learned';
      if (!tags.slice(1).some((tag) => tag !== 'learned')) tags[1] = 'saved';
      const queue = chooseServed(createQueue(words(tags)), rng);
      opportunities += 1;
      if (queue.entries[0].tag === 'learned') learnedServed += 1;
    }
    expect(opportunities).toBeGreaterThanOrEqual(1000);
    expect(learnedServed / opportunities).toBeGreaterThanOrEqual(0.45);
    expect(learnedServed / opportunities).toBeLessThanOrEqual(0.55);
  });
});
