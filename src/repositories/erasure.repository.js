/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Account erasure (FR-SET-08; SDD v1.1 §4.9, §5.5, C6).
 *
 * The ONLY module that deletes user data or history. It is called solely by
 * the hard-delete job (`purgeDueAccounts`), which in production runs under the
 * dedicated `pa_erase` credential (§4.9) — never by a request handler, and
 * never by the runtime `pa_app` principal, which holds no DELETE.
 *
 * Order is explicit and children-first, inside the caller's one transaction,
 * so every ON DELETE RESTRICT foreign key holds and no cascade is relied on:
 * derived and practice state, consents and events per owner (the account and
 * every anonymous identity bound to it); then word-request owners are nulled;
 * then tokens, bindings, the bound anonymous profiles, credentials, the user.
 */

import { defaultExecutor } from './transaction.js';

/** @typedef {{ userId: number } | { anonymousId: string }} Owner */

/** Per-owner deletes, children first (derived rows reference events). */
const PURGE_OWNER = Object.freeze({
  user: [
    'DELETE a FROM practice_attempts a JOIN practice_sessions s ON s.session_id = a.session_id WHERE s.user_id = ?',
    'DELETE FROM practice_sessions WHERE user_id = ?',
    'DELETE FROM sm2_states WHERE user_id = ?',
    'DELETE FROM user_word_states WHERE user_id = ?',
    'DELETE FROM user_phoneme_states WHERE user_id = ?',
    'DELETE FROM consent_records WHERE user_id = ?',
    'DELETE FROM user_activity_events WHERE user_id = ?',
  ],
  anonymous: [
    'DELETE a FROM practice_attempts a JOIN practice_sessions s ON s.session_id = a.session_id WHERE s.anonymous_id = ?',
    'DELETE FROM practice_sessions WHERE anonymous_id = ?',
    'DELETE FROM sm2_states WHERE anonymous_id = ?',
    'DELETE FROM user_word_states WHERE anonymous_id = ?',
    'DELETE FROM user_phoneme_states WHERE anonymous_id = ?',
    'DELETE FROM consent_records WHERE anonymous_id = ?',
    'DELETE FROM user_activity_events WHERE anonymous_id = ?',
  ],
});

/**
 * Accounts whose erasure is due: a direct hard delete, or a soft delete whose
 * 30-day window has passed (§5.5). Selection only; the claim decides.
 *
 * @param {Date} now
 * @returns {Promise<number[]>}
 */
export async function listDuePurges(now, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT user_id FROM users
      WHERE deletion_state = 'hard_delete_scheduled'
         OR (deletion_state = 'soft_deleted' AND hard_delete_scheduled_at <= ?)`,
    [now],
  );
  return rows.map((row) => Number(row.user_id));
}

/**
 * The C6 claim: flip the account to `hard_delete_in_progress` only if it is
 * still due. Exactly one concurrent caller sees `true`; a restored account no
 * longer matches, so a stale job is harmless.
 *
 * @returns {Promise<boolean>}
 */
export async function claimPurge(userId, now, executor) {
  const [result] = await executor.execute(
    `UPDATE users SET deletion_state = 'hard_delete_in_progress'
      WHERE user_id = ?
        AND (deletion_state = 'hard_delete_scheduled'
             OR (deletion_state = 'soft_deleted' AND hard_delete_scheduled_at <= ?))`,
    [userId, now],
  );
  return result.affectedRows === 1;
}

/** @returns {Promise<string[]>} the anonymous identities bound to the account */
export async function listBoundAnonymousIds(userId, executor) {
  const [rows] = await executor.execute('SELECT anonymous_id FROM identity_bindings WHERE user_id = ?', [userId]);
  return rows.map((row) => row.anonymous_id);
}

/** @returns {Promise<number[]>} practice session ids, to clear their live queues after commit */
export async function listPracticeSessionIds(userId, anonymousIds, executor) {
  const [userRows] = await executor.execute('SELECT session_id FROM practice_sessions WHERE user_id = ?', [userId]);
  const ids = userRows.map((row) => Number(row.session_id));
  for (const anonymousId of anonymousIds) {
    const [rows] = await executor.execute('SELECT session_id FROM practice_sessions WHERE anonymous_id = ?', [anonymousId]);
    ids.push(...rows.map((row) => Number(row.session_id)));
  }
  return ids;
}

/** Delete one owner's data, children first. @param {Owner} owner */
export async function purgeOwnerData(owner, executor) {
  const [statements, value] = 'userId' in owner ? [PURGE_OWNER.user, owner.userId] : [PURGE_OWNER.anonymous, owner.anonymousId];
  for (const sql of statements) await executor.execute(sql, [value]);
}

/** Word requests survive, ownerless (FR-SET-08). */
export async function orphanWordRequests(userId, anonymousIds, executor) {
  await executor.execute('UPDATE word_requests SET submitted_by_user_id = NULL WHERE submitted_by_user_id = ?', [userId]);
  for (const anonymousId of anonymousIds) {
    await executor.execute('UPDATE word_requests SET submitted_by_anonymous_id = NULL WHERE submitted_by_anonymous_id = ?', [
      anonymousId,
    ]);
  }
}

/** Tokens, bindings, the bound anonymous profiles, credentials, then the user. */
export async function deleteAccountRows(userId, anonymousIds, executor) {
  await executor.execute('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);
  await executor.execute('DELETE FROM identity_bindings WHERE user_id = ?', [userId]);
  for (const anonymousId of anonymousIds) {
    await executor.execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
  }
  await executor.execute('DELETE FROM user_accounts WHERE user_id = ?', [userId]);
  await executor.execute('DELETE FROM users WHERE user_id = ?', [userId]);
}

/** The tombstone: its own id, the kind, the time — nothing about the subject. */
export async function insertDeletionTombstone({ deletionId, deletionType, now }, executor) {
  await executor.execute('INSERT INTO deletion_audit (deletion_id, deletion_type, completed_at) VALUES (?, ?, ?)', [
    deletionId,
    deletionType,
    now,
  ]);
}
