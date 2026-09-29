/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Practice sessions (FR-PRACTICE-01/03/04/05/06; SDD v1.1 §4.6, §5.4).
 *
 * Entry distinguishes three states, and only the third starts a session: no
 * saved words; saved words but none due (with a read-only look at what is
 * coming up); one or more due. An owner's session that is still within its
 * 60-minute idle window is resumed where it stood; a stale one is finalised as
 * timed out on arrival, and one whose live queue was lost is finalised as
 * abandoned — its random choices were never persisted, so it is not rebuilt.
 *
 * Answering a turn is one MySQL transaction: the attempt (UNIQUE (session,
 * turn) — a replayed or concurrent answer to the same turn is refused by the
 * database and treated as a replay), the `practice_attempt` event with the SM-2
 * quality, the SM-2 update, and the idle-deadline refresh. Only after commit is
 * the live queue advanced in Redis. MySQL is authoritative: if the Redis step
 * fails, the committed answer stands and the session is ended as abandoned.
 */

import { AppError } from '../errors/index.js';
import { insertActivityEvent } from '../repositories/progress.repository.js';
import {
  countSavedWords,
  findActiveSession,
  findSession,
  findWordLocation,
  finaliseSession,
  insertAttempt,
  insertSession,
  listDueWords,
  listIdleSessions,
  listUpcomingWords,
  lockSm2State,
  touchSession,
  upsertSm2State,
} from '../repositories/practice.repository.js';
import { withTransaction } from '../repositories/transaction.js';
import { advance, chooseServed, createQueue, isFinished } from './practice-queue.service.js';
import { applySm2Review, INITIAL_SM2_STATE, nextDueAt, QUALITY } from './sm2.service.js';

/** FR-PRACTICE-06, Round 4 decision. */
export const PRACTICE_IDLE_MS = 60 * 60 * 1000;

/** @typedef {{ userId: number } | { anonymousId: string }} Owner */

/** @param {Owner} a @param {Owner} b */
const sameOwner = (a, b) =>
  ('userId' in a && 'userId' in b && a.userId === b.userId) ||
  ('anonymousId' in a && 'anonymousId' in b && a.anonymousId === b.anonymousId);

/**
 * Where the served word lives, so the turn can be rendered like its word page.
 *
 * @param {number} wordId
 * @returns {Promise<{ slug: string, variantCode: string }>}
 */
export async function findPracticeWordLocation(wordId) {
  const location = await findWordLocation(wordId);
  if (!location) throw AppError.notFound('That word could not be found.');
  return location;
}

/**
 * The practice owner of a request: the signed-in account, else the anonymous
 * identity, else nobody (nothing saved, nothing to practise).
 *
 * @param {{ userId: number|null, anonymousId: string|null }} viewer
 * @returns {Owner|null}
 */
export function practiceOwnerOf({ userId, anonymousId }) {
  if (userId !== null && userId !== undefined) return { userId };
  return anonymousId ? { anonymousId } : null;
}

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../lib/practice-queue-store.js').createPracticeQueueStore>} dependencies.queueStore
 * @param {() => number} dependencies.rng uniform in [0, 1)
 * @param {() => Date} [dependencies.clock]
 */
export function createPracticeService({ queueStore, rng, clock = () => new Date() }) {
  /** @param {number} sessionId @param {import('./practice-queue.service.js').PracticeQueue} queue */
  const turnOf = (sessionId, queue) => ({
    kind: 'turn',
    sessionId,
    turnSeq: queue.turnSeq,
    wordId: queue.entries[queue.position].wordId,
    number: queue.position + 1,
    total: queue.entries.length,
  });

  /** Finalise and drop the live queue; the queue removal is best effort. */
  async function end(sessionId, status) {
    await finaliseSession(sessionId, status, clock());
    await queueStore.remove(sessionId).catch(() => {});
  }

  /**
   * @param {Owner|null} owner
   * @returns {Promise<{ kind: 'empty' } | { kind: 'none-due' } | ReturnType<typeof turnOf>>}
   */
  async function enter(owner) {
    if (!owner) return { kind: 'empty' };
    const now = clock();

    const active = await findActiveSession(owner);
    if (active) {
      if (now.getTime() - active.lastInteractionAt.getTime() >= PRACTICE_IDLE_MS) {
        await end(active.sessionId, 'timed_out');
      } else {
        let queue = null;
        try {
          queue = await queueStore.load(active.sessionId);
        } catch {
          queue = null;
        }
        if (queue && !isFinished(queue)) return turnOf(active.sessionId, queue);
        await end(active.sessionId, 'abandoned');
      }
    }

    // Both counts, so zero saved and zero due are told apart (§5.4).
    if ((await countSavedWords(owner)) === 0) return { kind: 'empty' };
    const due = await listDueWords(owner, now);
    if (due.length === 0) return { kind: 'none-due' };

    const sessionId = await insertSession(owner, now, due);
    const queue = chooseServed(createQueue(due), rng);
    try {
      await queueStore.save(sessionId, queue);
    } catch (cause) {
      await finaliseSession(sessionId, 'abandoned', clock());
      throw AppError.unavailable('Practice is temporarily unavailable. Please try again shortly.', { cause });
    }
    return turnOf(sessionId, queue);
  }

  /**
   * FR-PRACTICE-03/04/05: answer the served turn.
   *
   * @param {Owner|null} owner
   * @param {{ sessionId: number, turnSeq: number, rating: 'right'|'wrong' }} answer
   * @returns {Promise<{ kind: 'next' } | { kind: 'complete', sessionId: number } | { kind: 'stale' } | { kind: 'restart' }>}
   *   `stale`: nothing written (a replay, another owner's session, or a turn
   *   no longer current) — the page simply shows the current state
   */
  async function answer(owner, { sessionId, turnSeq, rating }) {
    if (!owner) return { kind: 'stale' };
    const session = await findSession(sessionId);
    if (!session || session.status !== 'active' || !sameOwner(session.owner, owner)) return { kind: 'stale' };

    let queue;
    try {
      queue = await queueStore.load(sessionId);
    } catch {
      queue = null;
    }
    if (!queue || isFinished(queue)) {
      await end(sessionId, 'abandoned');
      return { kind: 'restart' };
    }
    if (turnSeq !== queue.turnSeq) return { kind: 'stale' };

    const wordId = queue.entries[queue.position].wordId;
    const quality = QUALITY[rating];
    const now = clock();
    const accepted = await withTransaction(async (tx) => {
      if (!(await insertAttempt({ sessionId, wordId, turnSeq, rating, now }, tx))) return false;
      await insertActivityEvent(
        { owner, targetKind: 'word', targetId: wordId, eventType: 'practice_attempt', eventValue: String(quality), occurredAt: now },
        tx,
      );
      const before = (await lockSm2State(owner, wordId, tx)) ?? INITIAL_SM2_STATE;
      const after = applySm2Review(before, quality);
      await upsertSm2State(
        { owner, wordId, state: after, nextDueAt: nextDueAt(now, after.intervalDays), reviewedAt: now },
        tx,
      );
      await touchSession(sessionId, now, tx);
      return true;
    });
    if (!accepted) return { kind: 'stale' };

    // Committed. Now the live queue; MySQL stays authoritative if this fails.
    try {
      const advanced = advance(queue, rating, rng);
      if (isFinished(advanced)) {
        await end(sessionId, 'completed');
        return { kind: 'complete', sessionId };
      }
      await queueStore.save(sessionId, chooseServed(advanced, rng));
      return { kind: 'next' };
    } catch {
      await end(sessionId, 'abandoned');
      return { kind: 'restart' };
    }
  }

  /** The read-only upcoming list (FR-PRACTICE-01). @param {Owner|null} owner */
  async function upcoming(owner) {
    return owner ? listUpcomingWords(owner, clock()) : [];
  }

  /**
   * A finished session's summary, for its owner only.
   *
   * @param {Owner|null} owner
   * @param {number} sessionId
   */
  async function summary(owner, sessionId) {
    if (!owner) return null;
    const session = await findSession(sessionId);
    if (!session || !sameOwner(session.owner, owner) || session.status !== 'completed') return null;
    return session;
  }

  /**
   * FR-PRACTICE-06: finalise every session idle for 60 minutes or more.
   * The recurring sweep's entry point; also safe to run by hand.
   *
   * @returns {Promise<number>} how many were finalised
   */
  async function sweepIdleSessions() {
    const cutoff = new Date(clock().getTime() - PRACTICE_IDLE_MS);
    let finalised = 0;
    for (const sessionId of await listIdleSessions(cutoff)) {
      if (await finaliseSession(sessionId, 'timed_out', clock())) finalised += 1;
      await queueStore.remove(sessionId).catch(() => {});
    }
    return finalised;
  }

  return { enter, answer, upcoming, summary, sweepIdleSessions };
}
