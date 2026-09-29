/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The live practice queue's rules (FR-PRACTICE-01/02/05/06; SDD v1.1 §5.4).
 *
 * Pure: a queue is a plain object, every operation returns a new one, and the
 * randomness is injected as `rng() → [0, 1)`, so a seeded generator reproduces
 * any sequence exactly in tests. Production passes a CSPRNG-backed generator;
 * none of these choices is a security value, but `Math.random` is banned from
 * the codebase outright (NFR-SEC-12).
 *
 *   - Serving (FR-PRACTICE-02): when the word at the head is tagged `learned`,
 *     then with probability 0.5 it is deferred to the next slot and the first
 *     non-`learned` word behind it is served instead, if there is one.
 *   - A wrong answer (FR-PRACTICE-05): the word goes back in, a uniformly
 *     chosen 3–7 slots ahead of the current position, or at the tail when
 *     fewer than 3 slots remain.
 *   - The session is over (FR-PRACTICE-06) when nothing is left to serve:
 *     every due word answered once and no reinsertion pending.
 *
 * The random choices are never persisted; a lost queue is not rebuilt exactly
 * (SDD §4.6).
 */

/**
 * @typedef {{ wordId: number, tag: 'saved'|'learning'|'learned' }} QueueEntry
 * @typedef {{ entries: QueueEntry[], position: number, turnSeq: number }} PracticeQueue
 *   `entries[position]` is the word currently served, with `turnSeq`
 */

export const LEARNED_DEFERRAL_PROBABILITY = 0.5;
export const REINSERT_MIN_AHEAD = 3;
export const REINSERT_MAX_AHEAD = 7;

/**
 * A new queue from the due words, in due order.
 *
 * @param {QueueEntry[]} dueWords
 * @returns {PracticeQueue}
 */
export function createQueue(dueWords) {
  return { entries: dueWords.map((entry) => ({ wordId: entry.wordId, tag: entry.tag })), position: 0, turnSeq: 0 };
}

/** @param {PracticeQueue} queue @returns {boolean} */
export function isFinished(queue) {
  return queue.position >= queue.entries.length;
}

/**
 * Decide which word is served at the current position (FR-PRACTICE-02). Call
 * once per turn, before serving; the result is the queue to serve from.
 *
 * @param {PracticeQueue} queue
 * @param {() => number} rng
 * @returns {PracticeQueue}
 */
export function chooseServed(queue, rng) {
  if (isFinished(queue)) return queue;
  const head = queue.entries[queue.position];
  if (head.tag !== 'learned') return queue;

  const alternative = queue.entries.findIndex((entry, index) => index > queue.position && entry.tag !== 'learned');
  if (alternative === -1) return queue;
  if (rng() >= LEARNED_DEFERRAL_PROBABILITY) return queue;

  // Surface the non-learned word now; the learned one takes the next slot.
  const entries = [...queue.entries];
  const [surfaced] = entries.splice(alternative, 1);
  entries.splice(queue.position, 0, surfaced);
  return { ...queue, entries };
}

/**
 * The slot a wrongly answered word returns to (FR-PRACTICE-05): uniformly
 * 3–7 ahead of the current position, or the tail when fewer than 3 slots
 * remain after it.
 *
 * @param {PracticeQueue} queue
 * @param {() => number} rng
 * @returns {number} the index to insert at
 */
export function reinsertionIndex(queue, rng) {
  const remaining = queue.entries.length - (queue.position + 1);
  if (remaining < REINSERT_MIN_AHEAD) return queue.entries.length;
  const ahead = REINSERT_MIN_AHEAD + Math.floor(rng() * (REINSERT_MAX_AHEAD - REINSERT_MIN_AHEAD + 1));
  // `ahead` slots from the current position: the word returns `ahead` turns
  // later (Handoff: "reinsertion at random 3–7 rounds"), never past the tail.
  return Math.min(queue.position + ahead, queue.entries.length);
}

/**
 * Record the answer to the current turn and move on.
 *
 * @param {PracticeQueue} queue
 * @param {'right'|'wrong'} rating
 * @param {() => number} rng
 * @returns {PracticeQueue}
 */
export function advance(queue, rating, rng) {
  if (isFinished(queue)) return queue;
  const entries = [...queue.entries];
  if (rating === 'wrong') {
    const current = entries[queue.position];
    entries.splice(reinsertionIndex(queue, rng), 0, { ...current });
  }
  return { entries, position: queue.position + 1, turnSeq: queue.turnSeq + 1 };
}
