/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Practice: the due set, SM-2 state, sessions and attempts (FR-PRACTICE-01/03/
 * 04/06; SDD v1.1 §4.6, §5.4).
 *
 * A saved word is a `user_word_states` row in any state but `unsaved`. It is
 * due when it has no `sm2_states` row (never practised) or its `next_due_at` is
 * not in the future. Every statement is static; the owner kind selects one.
 */

import { defaultExecutor } from './transaction.js';

/** @typedef {{ userId: number } | { anonymousId: string }} Owner */

/** @param {Owner} owner */
const who = (owner) => ('userId' in owner ? { kind: 'user', value: owner.userId } : { kind: 'anonymous', value: owner.anonymousId });

const SQL = Object.freeze({
  savedCount: {
    user: "SELECT COUNT(*) AS n FROM user_word_states WHERE user_id = ? AND state <> 'unsaved'",
    anonymous: "SELECT COUNT(*) AS n FROM user_word_states WHERE anonymous_id = ? AND state <> 'unsaved'",
  },
  // Due first by how long they have been due: a practised word since its
  // next_due_at, a never-practised one since it was saved.
  due: {
    user: `SELECT s.word_id, s.state FROM user_word_states s
             LEFT JOIN sm2_states m ON m.user_id = s.user_id AND m.word_id = s.word_id
            WHERE s.user_id = ? AND s.state <> 'unsaved' AND (m.sm2_id IS NULL OR m.next_due_at <= ?)
            ORDER BY COALESCE(m.next_due_at, s.updated_at), s.word_id`,
    anonymous: `SELECT s.word_id, s.state FROM user_word_states s
                  LEFT JOIN sm2_states m ON m.anonymous_id = s.anonymous_id AND m.word_id = s.word_id
                 WHERE s.anonymous_id = ? AND s.state <> 'unsaved' AND (m.sm2_id IS NULL OR m.next_due_at <= ?)
                 ORDER BY COALESCE(m.next_due_at, s.updated_at), s.word_id`,
  },
  upcoming: {
    user: `SELECT s.word_id, w.display_headword, w.normalized_headword, v.code AS variant_code, m.next_due_at
             FROM user_word_states s
             JOIN sm2_states m ON m.user_id = s.user_id AND m.word_id = s.word_id
             JOIN words w ON w.word_id = s.word_id
             JOIN language_variants v ON v.variant_id = w.variant_id
            WHERE s.user_id = ? AND s.state <> 'unsaved' AND m.next_due_at > ?
            ORDER BY m.next_due_at, s.word_id`,
    anonymous: `SELECT s.word_id, w.display_headword, w.normalized_headword, v.code AS variant_code, m.next_due_at
                  FROM user_word_states s
                  JOIN sm2_states m ON m.anonymous_id = s.anonymous_id AND m.word_id = s.word_id
                  JOIN words w ON w.word_id = s.word_id
                  JOIN language_variants v ON v.variant_id = w.variant_id
                 WHERE s.anonymous_id = ? AND s.state <> 'unsaved' AND m.next_due_at > ?
                 ORDER BY m.next_due_at, s.word_id`,
  },
  activeSession: {
    user: "SELECT session_id, last_interaction_at FROM practice_sessions WHERE user_id = ? AND status = 'active' ORDER BY session_id DESC LIMIT 1",
    anonymous:
      "SELECT session_id, last_interaction_at FROM practice_sessions WHERE anonymous_id = ? AND status = 'active' ORDER BY session_id DESC LIMIT 1",
  },
  lockSm2: {
    user: 'SELECT repetition_count, ease_factor, interval_days FROM sm2_states WHERE user_id = ? AND word_id = ? FOR UPDATE',
    anonymous:
      'SELECT repetition_count, ease_factor, interval_days FROM sm2_states WHERE anonymous_id = ? AND word_id = ? FOR UPDATE',
  },
});

/** @param {Owner} owner @returns {Promise<number>} */
export async function countSavedWords(owner, executor = defaultExecutor()) {
  const { kind, value } = who(owner);
  const [rows] = await executor.execute(SQL.savedCount[kind], [value]);
  return Number(rows[0].n);
}

/**
 * @param {Owner} owner
 * @param {Date} now
 * @returns {Promise<Array<{ wordId: number, tag: 'saved'|'learning'|'learned' }>>} in due order
 */
export async function listDueWords(owner, now, executor = defaultExecutor()) {
  const { kind, value } = who(owner);
  const [rows] = await executor.execute(SQL.due[kind], [value, now]);
  return rows.map((row) => ({ wordId: Number(row.word_id), tag: row.state }));
}

/**
 * Saved words scheduled into the future, soonest first. Read-only.
 *
 * @param {Owner} owner
 * @param {Date} now
 */
export async function listUpcomingWords(owner, now, executor = defaultExecutor()) {
  const { kind, value } = who(owner);
  const [rows] = await executor.execute(SQL.upcoming[kind], [value, now]);
  return rows.map((row) => ({
    wordId: Number(row.word_id),
    displayHeadword: row.display_headword,
    slug: row.normalized_headword,
    variantCode: row.variant_code,
    nextDueAt: row.next_due_at,
  }));
}

/**
 * The word a practice turn shows, for rendering it like a word page.
 *
 * @param {number} wordId
 * @returns {Promise<{ slug: string, variantCode: string } | null>}
 */
export async function findWordLocation(wordId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT w.normalized_headword, v.code FROM words w JOIN language_variants v ON v.variant_id = w.variant_id
      WHERE w.word_id = ?`,
    [wordId],
  );
  return rows.length === 0 ? null : { slug: rows[0].normalized_headword, variantCode: rows[0].code };
}

/**
 * @param {Owner} owner
 * @returns {Promise<{ sessionId: number, lastInteractionAt: Date } | null>} the owner's active session
 */
export async function findActiveSession(owner, executor = defaultExecutor()) {
  const { kind, value } = who(owner);
  const [rows] = await executor.execute(SQL.activeSession[kind], [value]);
  return rows.length === 0 ? null : { sessionId: Number(rows[0].session_id), lastInteractionAt: rows[0].last_interaction_at };
}

/**
 * @param {number} sessionId
 * @returns {Promise<{ sessionId: number, owner: Owner, status: string, lastInteractionAt: Date, totalAttempts: number, correctCount: number } | null>}
 */
export async function findSession(sessionId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT session_id, user_id, anonymous_id, status, last_interaction_at, total_attempts, correct_count
       FROM practice_sessions WHERE session_id = ?`,
    [sessionId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    sessionId: Number(row.session_id),
    owner: row.user_id === null ? { anonymousId: row.anonymous_id } : { userId: Number(row.user_id) },
    status: row.status,
    lastInteractionAt: row.last_interaction_at,
    totalAttempts: Number(row.total_attempts),
    correctCount: Number(row.correct_count),
  };
}

/**
 * @param {Owner} owner
 * @param {Date} now
 * @param {Array<{ wordId: number, tag: string }>} snapshot the initial queue (FR-PRACTICE-01)
 * @returns {Promise<number>} the session id
 */
export async function insertSession(owner, now, snapshot, executor = defaultExecutor()) {
  const [result] = await executor.execute(
    `INSERT INTO practice_sessions (user_id, anonymous_id, started_at, last_interaction_at, initial_queue_snapshot)
          VALUES (?, ?, ?, ?, ?)`,
    ['userId' in owner ? owner.userId : null, 'anonymousId' in owner ? owner.anonymousId : null, now, now, JSON.stringify(snapshot)],
  );
  return Number(result.insertId);
}

/** Refresh the idle deadline (FR-PRACTICE-06). */
export async function touchSession(sessionId, now, executor = defaultExecutor()) {
  await executor.execute('UPDATE practice_sessions SET last_interaction_at = ? WHERE session_id = ?', [now, sessionId]);
}

/**
 * Finalise an active session from its recorded attempts (FR-PRACTICE-06). Only
 * an active session changes, so a second finalisation is a no-op.
 *
 * @param {number} sessionId
 * @param {'completed'|'timed_out'|'abandoned'} status
 * @param {Date} now
 * @returns {Promise<boolean>} whether this call finalised it
 */
export async function finaliseSession(sessionId, status, now, executor = defaultExecutor()) {
  const [result] = await executor.execute(
    `UPDATE practice_sessions s
        SET s.status = ?, s.ended_at = ?,
            s.total_attempts = (SELECT COUNT(*) FROM practice_attempts a WHERE a.session_id = s.session_id),
            s.correct_count = (SELECT COUNT(*) FROM practice_attempts a WHERE a.session_id = s.session_id AND a.rating = 'right')
      WHERE s.session_id = ? AND s.status = 'active'`,
    [status, now, sessionId],
  );
  return result.affectedRows === 1;
}

/**
 * Active sessions idle since before `cutoff`, for the sweep (FR-PRACTICE-06).
 *
 * @param {Date} cutoff
 * @returns {Promise<number[]>}
 */
export async function listIdleSessions(cutoff, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    "SELECT session_id FROM practice_sessions WHERE status = 'active' AND last_interaction_at < ?",
    [cutoff],
  );
  return rows.map((row) => Number(row.session_id));
}

/**
 * One accepted answer per served turn: the unique key refuses a second.
 *
 * @returns {Promise<boolean>} false when this turn already has an answer
 */
export async function insertAttempt({ sessionId, wordId, turnSeq, rating, now }, executor = defaultExecutor()) {
  try {
    await executor.execute(
      'INSERT INTO practice_attempts (session_id, word_id, turn_seq, rating, attempted_at) VALUES (?, ?, ?, ?, ?)',
      [sessionId, wordId, turnSeq, rating, now],
    );
    return true;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' && String(error.message).includes('uq_practice_attempts_turn')) return false;
    throw error;
  }
}

/**
 * @param {Owner} owner
 * @param {number} wordId
 * @returns {Promise<{ repetitionCount: number, easeFactor: number, intervalDays: number } | null>}
 */
export async function lockSm2State(owner, wordId, executor) {
  const { kind, value } = who(owner);
  const [rows] = await executor.execute(SQL.lockSm2[kind], [value, wordId]);
  if (rows.length === 0) return null;
  return {
    repetitionCount: Number(rows[0].repetition_count),
    easeFactor: Number(rows[0].ease_factor),
    intervalDays: Number(rows[0].interval_days),
  };
}

/**
 * Write the SM-2 state after a review; the first answer creates the row.
 */
export async function upsertSm2State({ owner, wordId, state, nextDueAt, reviewedAt }, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO sm2_states
            (user_id, anonymous_id, word_id, repetition_count, ease_factor, interval_days, next_due_at, last_reviewed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) AS incoming
     ON DUPLICATE KEY UPDATE
            repetition_count = incoming.repetition_count, ease_factor = incoming.ease_factor,
            interval_days = incoming.interval_days, next_due_at = incoming.next_due_at,
            last_reviewed_at = incoming.last_reviewed_at, updated_at = incoming.updated_at`,
    [
      'userId' in owner ? owner.userId : null,
      'anonymousId' in owner ? owner.anonymousId : null,
      wordId,
      state.repetitionCount,
      state.easeFactor,
      state.intervalDays,
      nextDueAt,
      reviewedAt,
      reviewedAt,
    ],
  );
}
