/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * SQL for learner progress: anonymous profiles, the append-only event log and
 * the derived save state (FR-SAVE-03/04, FR-AUTH-03, B1, B3, C5; SDD v1.1
 * §4.3–§4.5).
 *
 * `user_activity_events` is append-only: this module INSERTs and SELECTs it and
 * has no code path that updates or deletes it (FR-SAVE-03). The derived state
 * tables take INSERT, UPDATE and SELECT, never DELETE — an unsave is the value
 * `unsaved`, not a removed row (SDD §4.5).
 *
 * An owner is `{ userId }` or `{ anonymousId }`, exactly one, mirroring the
 * one-owner CHECK on every table here.
 */

import { defaultExecutor } from './transaction.js';

/**
 * @typedef {{ userId: number } | { anonymousId: string }} Owner
 */

/** @typedef {'unsaved'|'saved'|'learning'|'learned'} SaveState */

/**
 * Every statement below is static SQL (NFR-SEC-07). Target kind and owner kind
 * each select a statement rather than an interpolated identifier, and the owner
 * is matched with a plain equality on its own column so the lookup rides the
 * `(owner, target)` unique key.
 *
 * @param {Owner} owner
 * @returns {{ kind: 'user'|'anonymous', value: number|string }}
 */
function ownerOf(owner) {
  return 'userId' in owner ? { kind: 'user', value: owner.userId } : { kind: 'anonymous', value: owner.anonymousId };
}

/** @param {Owner} owner @returns {[number|null, string|null]} the two owner columns, one null */
function ownerColumns(owner) {
  return 'userId' in owner ? [owner.userId, null] : [null, owner.anonymousId];
}

const SQL = Object.freeze({
  word: {
    lock: {
      user: 'SELECT state FROM user_word_states WHERE user_id = ? AND word_id = ? FOR UPDATE',
      anonymous: 'SELECT state FROM user_word_states WHERE anonymous_id = ? AND word_id = ? FOR UPDATE',
    },
    states: {
      user: `SELECT word_id AS target_id, state FROM user_word_states
              WHERE user_id = ? AND word_id MEMBER OF (CAST(? AS JSON))`,
      anonymous: `SELECT word_id AS target_id, state FROM user_word_states
                   WHERE anonymous_id = ? AND word_id MEMBER OF (CAST(? AS JSON))`,
    },
    upsert: `INSERT INTO user_word_states (user_id, anonymous_id, word_id, state, last_event_id, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?) AS incoming
             ON DUPLICATE KEY UPDATE
                  state         = IF(incoming.last_event_id > user_word_states.last_event_id, incoming.state, user_word_states.state),
                  updated_at    = IF(incoming.last_event_id > user_word_states.last_event_id, incoming.updated_at, user_word_states.updated_at),
                  last_event_id = GREATEST(user_word_states.last_event_id, incoming.last_event_id)`,
    exists: 'SELECT 1 FROM words WHERE word_id = ?',
  },
  phoneme: {
    lock: {
      user: 'SELECT state FROM user_phoneme_states WHERE user_id = ? AND phoneme_id = ? FOR UPDATE',
      anonymous: 'SELECT state FROM user_phoneme_states WHERE anonymous_id = ? AND phoneme_id = ? FOR UPDATE',
    },
    states: {
      user: `SELECT phoneme_id AS target_id, state FROM user_phoneme_states
              WHERE user_id = ? AND phoneme_id MEMBER OF (CAST(? AS JSON))`,
      anonymous: `SELECT phoneme_id AS target_id, state FROM user_phoneme_states
                   WHERE anonymous_id = ? AND phoneme_id MEMBER OF (CAST(? AS JSON))`,
    },
    upsert: `INSERT INTO user_phoneme_states (user_id, anonymous_id, phoneme_id, state, last_event_id, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?) AS incoming
             ON DUPLICATE KEY UPDATE
                  state         = IF(incoming.last_event_id > user_phoneme_states.last_event_id, incoming.state, user_phoneme_states.state),
                  updated_at    = IF(incoming.last_event_id > user_phoneme_states.last_event_id, incoming.updated_at, user_phoneme_states.updated_at),
                  last_event_id = GREATEST(user_phoneme_states.last_event_id, incoming.last_event_id)`,
    exists: 'SELECT 1 FROM phonemes WHERE phoneme_id = ?',
  },
  learnedCount: {
    user: `SELECT COUNT(*) AS learned FROM user_phoneme_states s JOIN phonemes p ON p.phoneme_id = s.phoneme_id
            WHERE s.user_id = ? AND s.state = 'learned' AND p.variant_id = ?`,
    anonymous: `SELECT COUNT(*) AS learned FROM user_phoneme_states s JOIN phonemes p ON p.phoneme_id = s.phoneme_id
                 WHERE s.anonymous_id = ? AND s.state = 'learned' AND p.variant_id = ?`,
  },
});

/**
 * The account an anonymous identity is bound to, if any (B1).
 *
 * @param {string} anonymousId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number|null>}
 */
export async function findBoundUserId(anonymousId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    'SELECT user_id FROM current_identity_bindings WHERE anonymous_id = ?',
    [anonymousId],
  );
  return rows.length > 0 ? Number(rows[0].user_id) : null;
}

/**
 * @param {string} anonymousId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<boolean>} true when a progress profile exists (FR-AUTH-03)
 */
export async function anonymousProfileExists(anonymousId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    'SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?',
    [anonymousId],
  );
  return rows.length > 0;
}

/**
 * Create the profile on the first write from a UUID, or refresh `last_seen_at`
 * on a later one (FR-AUTH-03, NFR-PRIV-02 dormancy). One statement, so two
 * concurrent first writes converge on one row.
 *
 * @param {string} anonymousId
 * @param {Date} now
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<void>}
 */
export async function touchAnonymousProfile(anonymousId, now, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO anonymous_profiles (anonymous_id, created_at, last_seen_at)
          VALUES (?, ?, ?) AS incoming
     ON DUPLICATE KEY UPDATE last_seen_at = incoming.last_seen_at`,
    [anonymousId, now, now],
  );
}

/**
 * Lock and read the owner's current state for one target, inside a
 * transaction, so concurrent writes to the same target serialise.
 *
 * @param {Owner} owner
 * @param {'word'|'phoneme'} targetKind
 * @param {number} targetId
 * @param {import('./transaction.js').Executor} executor a transaction connection
 * @returns {Promise<SaveState>} `unsaved` when no row exists yet
 */
export async function lockTargetState(owner, targetKind, targetId, executor) {
  const who = ownerOf(owner);
  const [rows] = await executor.execute(SQL[targetKind].lock[who.kind], [who.value, targetId]);
  return rows.length > 0 ? rows[0].state : 'unsaved';
}

/**
 * Append one event (FR-SAVE-03). Never updates an existing row.
 *
 * @param {object} event
 * @param {Owner} event.owner
 * @param {'word'|'phoneme'} event.targetKind
 * @param {number} event.targetId
 * @param {string} event.eventType
 * @param {string|null} event.eventValue
 * @param {Date} event.occurredAt
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>} the new `event_id`
 */
export async function insertActivityEvent(
  { owner, targetKind, targetId, eventType, eventValue, occurredAt },
  executor = defaultExecutor(),
) {
  const [result] = await executor.execute(
    `INSERT INTO user_activity_events
            (anonymous_id, user_id, target_kind, target_id, event_type, event_value, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'anonymousId' in owner ? owner.anonymousId : null,
      'userId' in owner ? owner.userId : null,
      targetKind,
      targetId,
      eventType,
      eventValue,
      occurredAt,
    ],
  );
  return Number(result.insertId);
}

/**
 * Project the latest qualifying event onto the derived state row (B3).
 *
 * The update only moves forward: a row already reflecting a later event is left
 * alone, so two writes that reach this statement out of order cannot leave an
 * older state standing. `event_id` is the C5 tie-breaker and is monotonic with
 * the server-assigned `occurred_at`.
 *
 * @param {object} projection
 * @param {Owner} projection.owner
 * @param {'word'|'phoneme'} projection.targetKind
 * @param {number} projection.targetId
 * @param {SaveState} projection.state
 * @param {number} projection.lastEventId
 * @param {Date} projection.updatedAt
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<void>}
 */
export async function upsertTargetState(
  { owner, targetKind, targetId, state, lastEventId, updatedAt },
  executor = defaultExecutor(),
) {
  await executor.execute(SQL[targetKind].upsert, [...ownerColumns(owner), targetId, state, lastEventId, updatedAt]);
}

/**
 * The owner's states for a set of targets, for hydration.
 *
 * @param {Owner} owner
 * @param {'word'|'phoneme'} targetKind
 * @param {number[]} targetIds
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Map<number, SaveState>>} only targets with a row
 */
export async function findTargetStates(owner, targetKind, targetIds, executor = defaultExecutor()) {
  if (targetIds.length === 0) return new Map();
  const who = ownerOf(owner);
  const [rows] = await executor.execute(SQL[targetKind].states[who.kind], [who.value, JSON.stringify(targetIds)]);
  return new Map(rows.map((row) => [Number(row.target_id), row.state]));
}

/**
 * The FR-WORD-06 learned count for a variant: a filtered count over
 * `user_phoneme_states` (SDD §4.5).
 *
 * @param {Owner} owner
 * @param {number} variantId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>}
 */
export async function countLearnedPhonemes(owner, variantId, executor = defaultExecutor()) {
  const who = ownerOf(owner);
  const [rows] = await executor.execute(SQL.learnedCount[who.kind], [who.value, variantId]);
  return Number(rows[0].learned);
}

/**
 * Whether a target row exists in the catalogue, since `target_id` is
 * polymorphic and carries no foreign key (SDD §4.4).
 *
 * @param {'word'|'phoneme'} targetKind
 * @param {number} targetId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<boolean>}
 */
export async function targetExists(targetKind, targetId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(SQL[targetKind].exists, [targetId]);
  return rows.length > 0;
}
