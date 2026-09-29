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
    label: `SELECT w.display_headword AS label, v.code AS variant_code
              FROM words w JOIN language_variants v ON v.variant_id = w.variant_id
             WHERE w.word_id = ?`,
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
    label: `SELECT p.ipa_symbol AS label, v.code AS variant_code
              FROM phonemes p JOIN language_variants v ON v.variant_id = p.variant_id
             WHERE p.phoneme_id = ?`,
  },
  learnedCount: {
    user: `SELECT COUNT(*) AS learned FROM user_phoneme_states s JOIN phonemes p ON p.phoneme_id = s.phoneme_id
            WHERE s.user_id = ? AND s.state = 'learned' AND p.variant_id = ?`,
    anonymous: `SELECT COUNT(*) AS learned FROM user_phoneme_states s JOIN phonemes p ON p.phoneme_id = s.phoneme_id
                 WHERE s.anonymous_id = ? AND s.state = 'learned' AND p.variant_id = ?`,
  },
  // FR-AUTH-17: saved items, words and phonemes together, by derived state.
  savedCount: {
    anonymous: `SELECT (SELECT COUNT(*) FROM user_word_states WHERE anonymous_id = ? AND state <> 'unsaved')
                     + (SELECT COUNT(*) FROM user_phoneme_states WHERE anonymous_id = ? AND state <> 'unsaved') AS saved`,
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
 * Append one `word_encounter` event unless the owner already has one for this
 * word on this UTC day (FR-SAVE-10, V9).
 *
 * The daily limit is the `uq_user_activity_events_encounter_day` unique key on a
 * generated column, so the duplicate is refused by the database and reported
 * here as `false`. Nothing is updated or deleted: the earlier event stands.
 *
 * @param {object} encounter
 * @param {Owner} encounter.owner
 * @param {number} encounter.wordId
 * @param {Date} encounter.occurredAt
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} [executor]
 * @returns {Promise<boolean>} whether a row was written
 */
export async function insertWordEncounter({ owner, wordId, occurredAt }, executor = defaultExecutor()) {
  try {
    await insertActivityEvent(
      { owner, targetKind: 'word', targetId: wordId, eventType: 'word_encounter', eventValue: null, occurredAt },
      executor,
    );
    return true;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' && String(error.message).includes('uq_user_activity_events_encounter_day')) {
      return false;
    }
    throw error;
  }
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
 * How many words and phonemes an anonymous identity has saved, in any tag
 * (FR-AUTH-17). Counted from derived state, as the requirement says.
 *
 * @param {string} anonymousId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>}
 */
export async function countAnonymousSavedTargets(anonymousId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(SQL.savedCount.anonymous, [anonymousId, anonymousId]);
  return Number(rows[0].saved);
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

/**
 * How to name a target to a person: a word's display headword or a phoneme's
 * symbol, with its variant code.
 *
 * @param {'word'|'phoneme'} targetKind
 * @param {number} targetId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<{ label: string, variantCode: string } | null>}
 */
export async function findTargetLabel(targetKind, targetId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(SQL[targetKind].label, [targetId]);
  return rows.length > 0 ? { label: rows[0].label, variantCode: rows[0].variant_code } : null;
}

/*
 * Reconciliation reads and the repair write (FR-SAVE-04, B3; SDD v1.1 §4.5).
 *
 * The derived tables are rebuilt from the log for one RESOLVED owner at a time:
 * an anonymous identity bound to an account (B1) belongs to that account, so
 * its events count toward the user's state, exactly as the live write resolves
 * the owner. Non-state events are excluded by the same list as FR-SAVE-04.
 * Nothing here updates or deletes an event.
 */

const NON_STATE_EVENTS = "('audio_listen_word', 'audio_listen_phoneme', 'practice_attempt', 'word_encounter')";

const RECONCILE_SQL = Object.freeze({
  owners:
    'SELECT DISTINCT COALESCE(e.user_id, b.user_id) AS owner_user, ' +
    'IF(COALESCE(e.user_id, b.user_id) IS NULL, e.anonymous_id, NULL) AS owner_anonymous ' +
    'FROM user_activity_events e LEFT JOIN current_identity_bindings b ON b.anonymous_id = e.anonymous_id ' +
    'WHERE e.event_type NOT IN ' + NON_STATE_EVENTS + ' ' +
    'UNION SELECT DISTINCT user_id, anonymous_id FROM user_word_states ' +
    'UNION SELECT DISTINCT user_id, anonymous_id FROM user_phoneme_states',
  events: {
    user:
      'SELECT e.event_id, e.target_kind, e.target_id, e.event_type, e.event_value ' +
      'FROM user_activity_events e LEFT JOIN current_identity_bindings b ON b.anonymous_id = e.anonymous_id ' +
      'WHERE (e.user_id = ? OR b.user_id = ?) AND e.event_type NOT IN ' + NON_STATE_EVENTS + ' ' +
      'ORDER BY e.target_kind, e.target_id, e.occurred_at, e.event_id',
    anonymous:
      'SELECT e.event_id, e.target_kind, e.target_id, e.event_type, e.event_value ' +
      'FROM user_activity_events e LEFT JOIN current_identity_bindings b ON b.anonymous_id = e.anonymous_id ' +
      'WHERE e.anonymous_id = ? AND b.user_id IS NULL AND e.event_type NOT IN ' + NON_STATE_EVENTS + ' ' +
      'ORDER BY e.target_kind, e.target_id, e.occurred_at, e.event_id',
  },
  states: {
    user:
      "SELECT 'word' AS target_kind, word_id AS target_id, state, last_event_id FROM user_word_states WHERE user_id = ? " +
      "UNION ALL SELECT 'phoneme', phoneme_id, state, last_event_id FROM user_phoneme_states WHERE user_id = ?",
    anonymous:
      "SELECT 'word' AS target_kind, word_id AS target_id, state, last_event_id FROM user_word_states WHERE anonymous_id = ? " +
      "UNION ALL SELECT 'phoneme', phoneme_id, state, last_event_id FROM user_phoneme_states WHERE anonymous_id = ?",
  },
  lockStates: {
    user: [
      'SELECT state_id FROM user_word_states WHERE user_id = ? FOR UPDATE',
      'SELECT state_id FROM user_phoneme_states WHERE user_id = ? FOR UPDATE',
    ],
    anonymous: [
      'SELECT state_id FROM user_word_states WHERE anonymous_id = ? FOR UPDATE',
      'SELECT state_id FROM user_phoneme_states WHERE anonymous_id = ? FOR UPDATE',
    ],
  },
  repair: {
    word:
      'INSERT INTO user_word_states (user_id, anonymous_id, word_id, state, last_event_id, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?) AS incoming ON DUPLICATE KEY UPDATE state = incoming.state, ' +
      'last_event_id = incoming.last_event_id, updated_at = incoming.updated_at',
    phoneme:
      'INSERT INTO user_phoneme_states (user_id, anonymous_id, phoneme_id, state, last_event_id, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?) AS incoming ON DUPLICATE KEY UPDATE state = incoming.state, ' +
      'last_event_id = incoming.last_event_id, updated_at = incoming.updated_at',
  },
});

/**
 * Every resolved owner that has state events or a derived row.
 *
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Owner[]>}
 */
export async function listReconciliationOwners(executor = defaultExecutor()) {
  const [rows] = await executor.query(RECONCILE_SQL.owners);
  return rows.map((row) =>
    row.owner_user !== null ? { userId: Number(row.owner_user) } : { anonymousId: row.owner_anonymous },
  );
}

/**
 * The owner's state events in `(target, occurred_at, event_id)` order (C5).
 * Inside a repair transaction this follows {@link lockOwnerStates}, so a live
 * write to the same owner waits on the state rows and cannot interleave.
 *
 * @param {Owner} owner
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Array<{ eventId: number, targetKind: string, targetId: number, eventType: string, eventValue: string|null }>>}
 */
export async function listOwnerStateEvents(owner, executor = defaultExecutor()) {
  const who = ownerOf(owner);
  const params = who.kind === 'user' ? [who.value, who.value] : [who.value];
  const [rows] = await executor.execute(RECONCILE_SQL.events[who.kind], params);
  return rows.map((row) => ({
    eventId: Number(row.event_id),
    targetKind: row.target_kind,
    targetId: Number(row.target_id),
    eventType: row.event_type,
    eventValue: row.event_value,
  }));
}

/**
 * The owner's live derived rows.
 *
 * @param {Owner} owner
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<Array<{ targetKind: string, targetId: number, state: string, lastEventId: number }>>}
 */
export async function listOwnerStates(owner, executor = defaultExecutor()) {
  const who = ownerOf(owner);
  const [rows] = await executor.execute(RECONCILE_SQL.states[who.kind], [who.value, who.value]);
  return rows.map((row) => ({
    targetKind: row.target_kind,
    targetId: Number(row.target_id),
    state: row.state,
    lastEventId: Number(row.last_event_id),
  }));
}

/**
 * Lock the owner's derived rows for a repair: the C6 per-actor claim. A live
 * save locks the same rows first, so the two serialise.
 *
 * @param {Owner} owner
 * @param {import('./transaction.js').Executor} executor a transaction connection
 * @returns {Promise<void>}
 */
export async function lockOwnerStates(owner, executor) {
  const who = ownerOf(owner);
  for (const statement of RECONCILE_SQL.lockStates[who.kind]) {
    await executor.execute(statement, [who.value]);
  }
}

/**
 * Set a derived row to exactly what the log derives. Unlike the live
 * projection this does not only move forward: it is the correction.
 *
 * @param {object} repair
 * @param {Owner} repair.owner
 * @param {'word'|'phoneme'} repair.targetKind
 * @param {number} repair.targetId
 * @param {string} repair.state
 * @param {number} repair.lastEventId
 * @param {Date} repair.updatedAt
 * @param {import('./transaction.js').Executor} executor
 * @returns {Promise<void>}
 */
export async function repairTargetState({ owner, targetKind, targetId, state, lastEventId, updatedAt }, executor) {
  await executor.execute(RECONCILE_SQL.repair[targetKind], [
    ...ownerColumns(owner),
    targetId,
    state,
    lastEventId,
    updatedAt,
  ]);
}
