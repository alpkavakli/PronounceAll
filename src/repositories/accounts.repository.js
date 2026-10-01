/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Users, their sign-in credentials, and consent records (FR-AUTH-04/05/06/08,
 * FR-CONSENT-04, V3; SDD v1.1 §4.3, §4.7).
 *
 * `users` is pure identity plus the authoritative `session_epoch` (V3);
 * credentials live one row per method in `user_accounts`. Uniqueness is the
 * database's: `username_lower` and `email_lower` carry unique keys, and a
 * violation surfaces as {@link DuplicateIdentityError} naming which one, so the
 * service can shape the message without a racy read-before-write.
 */

import { defaultExecutor } from './transaction.js';

export class DuplicateIdentityError extends Error {
  /** @param {'username'|'email'} field */
  constructor(field) {
    super(`duplicate ${field}`);
    this.field = field;
  }
}

/** @param {unknown} error @returns {never} */
function rethrowDuplicate(error) {
  if (error?.code === 'ER_DUP_ENTRY') {
    const message = String(error.message);
    if (message.includes('uq_users_username_lower')) throw new DuplicateIdentityError('username');
    if (message.includes('uq_user_accounts_email_lower')) throw new DuplicateIdentityError('email');
    if (message.includes('uq_user_accounts_google_sub')) throw new DuplicateIdentityError('google');
  }
  throw error;
}

/**
 * A Google credential (FR-AUTH-04a). Keyed by Google's stable subject; the
 * email Google verified is recorded as verified, and takes part in the same
 * `email_lower` uniqueness as every other account (FR-AUTH-06).
 *
 * @param {object} account
 * @param {number} account.userId
 * @param {string} account.googleSub
 * @param {string} account.email
 * @param {string|null} account.pictureUrl
 * @param {Date} account.now
 * @param {import('./transaction.js').Executor} [executor]
 */
export async function insertGoogleAccount({ userId, googleSub, email, pictureUrl, now }, executor = defaultExecutor()) {
  try {
    await executor.execute(
      `INSERT INTO user_accounts
              (user_id, provider, email, email_lower, email_verified_at, google_sub, profile_picture_url, created_at, updated_at)
            VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?)`,
      [userId, email, email.toLowerCase(), now, googleSub, pictureUrl, now, now],
    );
  } catch (error) {
    rethrowDuplicate(error);
  }
}

/**
 * The account behind a Google subject, for sign-in.
 *
 * @param {string} googleSub
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<{ userId: number, sessionEpoch: number, deletionState: string } | null>}
 */
export async function findGoogleAccount(googleSub, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT u.user_id, u.session_epoch, u.deletion_state
       FROM user_accounts a JOIN users u ON u.user_id = a.user_id
      WHERE a.google_sub = ? AND a.provider = 'google'`,
    [googleSub],
  );
  if (rows.length === 0) return null;
  return { userId: Number(rows[0].user_id), sessionEpoch: Number(rows[0].session_epoch), deletionState: rows[0].deletion_state };
}

/**
 * Whether any account, of any sign-in method, holds this email (FR-AUTH-06).
 *
 * @param {string} email
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<boolean>}
 */
export async function emailIsTaken(email, executor = defaultExecutor()) {
  // A pending change reserves its address too (FR-AUTH-06: "verified or pending").
  const lowered = email.toLowerCase();
  const [rows] = await executor.execute(
    'SELECT 1 FROM user_accounts WHERE email_lower = ? OR pending_email_lower = ? LIMIT 1',
    [lowered, lowered],
  );
  return rows.length > 0;
}

/**
 * The password credential of a signed-in user, for re-checking the current
 * password (FR-SET-02).
 *
 * @param {number} userId
 * @returns {Promise<{ passwordHash: string, email: string|null, emailVerifiedAt: Date|null, sessionEpoch: number } | null>}
 */
export async function findPasswordCredentialByUserId(userId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT a.password_hash, a.email, a.email_verified_at, u.session_epoch
       FROM user_accounts a JOIN users u ON u.user_id = a.user_id
      WHERE a.user_id = ? AND a.provider = 'password'`,
    [userId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    passwordHash: row.password_hash,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    sessionEpoch: Number(row.session_epoch),
  };
}

/**
 * Hold a new address as pending (FR-SET-02). The current email is untouched.
 *
 * @throws {DuplicateIdentityError} ('email') when another pending change holds it
 */
export async function setPendingEmail({ userId, email, now }, executor = defaultExecutor()) {
  try {
    await executor.execute(
      `UPDATE user_accounts SET pending_email = ?, pending_email_lower = ?, updated_at = ?
        WHERE user_id = ? AND provider = 'password'`,
      [email, email.toLowerCase(), now, userId],
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' && String(error.message).includes('uq_user_accounts_pending_email_lower')) {
      throw new DuplicateIdentityError('email');
    }
    throw error;
  }
}

/**
 * Make the pending address the account's email, verified now, and clear the
 * pending columns. UNIQUE (email_lower) is the final word on uniqueness.
 *
 * @returns {Promise<boolean>} false when there was nothing pending
 * @throws {DuplicateIdentityError} ('email') when another account took it meanwhile
 */
export async function confirmPendingEmail({ userId, now }, executor) {
  try {
    const [result] = await executor.execute(
      `UPDATE user_accounts
          SET email = pending_email, email_lower = pending_email_lower, email_verified_at = ?,
              pending_email = NULL, pending_email_lower = NULL, updated_at = ?
        WHERE user_id = ? AND provider = 'password' AND pending_email IS NOT NULL`,
      [now, now, userId],
    );
    return result.affectedRows === 1;
  } catch (error) {
    rethrowDuplicate(error);
    return false;
  }
}

/** Drop a pending change that can no longer complete. */
export async function clearPendingEmail({ userId, now }, executor = defaultExecutor()) {
  await executor.execute(
    `UPDATE user_accounts SET pending_email = NULL, pending_email_lower = NULL, updated_at = ?
      WHERE user_id = ? AND provider = 'password'`,
    [now, userId],
  );
}

/**
 * @param {object} user
 * @param {string} user.username as typed
 * @param {Date} user.now
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<number>} the new `user_id`
 */
export async function insertUser({ username, now }, executor = defaultExecutor()) {
  try {
    const [result] = await executor.execute(
      `INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [username, username.toLowerCase(), now, now],
    );
    return Number(result.insertId);
  } catch (error) {
    return rethrowDuplicate(error);
  }
}

/**
 * @param {object} account
 * @param {number} account.userId
 * @param {string} account.passwordHash bcrypt, `$2b$12$…` (FR-AUTH-08)
 * @param {string|null} [account.email]
 * @param {Date} account.now
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<void>}
 */
export async function insertPasswordAccount({ userId, passwordHash, email = null, now }, executor = defaultExecutor()) {
  try {
    await executor.execute(
      `INSERT INTO user_accounts (user_id, provider, email, email_lower, password_hash, created_at, updated_at)
            VALUES (?, 'password', ?, ?, ?, ?, ?)`,
      [userId, email, email === null ? null : email.toLowerCase(), passwordHash, now, now],
    );
  } catch (error) {
    rethrowDuplicate(error);
  }
}

/**
 * @param {object} record
 * @param {number} record.userId
 * @param {'no_recovery_ack'} record.consentType
 * @param {'acknowledged'} record.consentValue
 * @param {Date} record.now
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<void>}
 */
export async function insertUserConsent({ userId, consentType, consentValue, now }, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO consent_records (user_id, consent_type, consent_value, recorded_at) VALUES (?, ?, ?, ?)`,
    [userId, consentType, consentValue, now],
  );
}

/**
 * The password credential behind a username, for login.
 *
 * @param {string} username compared case-insensitively (FR-AUTH-05)
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<{ userId: number, username: string, passwordHash: string, email: string|null, emailVerifiedAt: Date|null, sessionEpoch: number, deletionState: string } | null>}
 */
export async function findPasswordCredentialByUsername(username, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT u.user_id, u.username, u.session_epoch, u.deletion_state,
            a.password_hash, a.email, a.email_verified_at
       FROM users u
       JOIN user_accounts a ON a.user_id = u.user_id AND a.provider = 'password'
      WHERE u.username_lower = ?`,
    [username.toLowerCase()],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    userId: Number(row.user_id),
    username: row.username,
    passwordHash: row.password_hash,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    sessionEpoch: Number(row.session_epoch),
    deletionState: row.deletion_state,
  };
}

/**
 * The password credential behind an email address, for login by email and for
 * the verification and reset flows.
 *
 * @param {string} email compared lower-cased (FR-AUTH-06)
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<{ userId: number, username: string, passwordHash: string, email: string|null, emailVerifiedAt: Date|null, sessionEpoch: number, deletionState: string } | null>}
 */
export async function findPasswordCredentialByEmail(email, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT u.user_id, u.username, u.session_epoch, u.deletion_state,
            a.password_hash, a.email, a.email_verified_at
       FROM user_accounts a
       JOIN users u ON u.user_id = a.user_id
      WHERE a.email_lower = ? AND a.provider = 'password'`,
    [email.toLowerCase()],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    userId: Number(row.user_id),
    username: row.username,
    passwordHash: row.password_hash,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    sessionEpoch: Number(row.session_epoch),
    deletionState: row.deletion_state,
  };
}

/**
 * The email address and its verification state for a user's password account.
 *
 * @param {number} userId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<{ email: string|null, emailVerifiedAt: Date|null } | null>}
 */
export async function findAccountEmail(userId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    "SELECT email, email_verified_at FROM user_accounts WHERE user_id = ? AND provider = 'password'",
    [userId],
  );
  return rows.length === 0 ? null : { email: rows[0].email, emailVerifiedAt: rows[0].email_verified_at };
}

/**
 * Mark the email verified, once; a later call leaves the first time in place.
 *
 * @param {number} userId
 * @param {Date} now
 * @param {import('./transaction.js').Executor} [executor]
 */
export async function markEmailVerified(userId, now, executor = defaultExecutor()) {
  await executor.execute(
    `UPDATE user_accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?
      WHERE user_id = ? AND provider = 'password' AND email IS NOT NULL`,
    [now, now, userId],
  );
}

/**
 * A password change: the new hash and `session_epoch + 1` in the caller's
 * transaction, so every existing session stops authorising at once (V3).
 *
 * @param {object} change
 * @param {number} change.userId
 * @param {string} change.passwordHash
 * @param {Date} change.now
 * @param {import('./transaction.js').Executor} executor a transaction connection
 */
export async function replacePasswordAndEndSessions({ userId, passwordHash, now }, executor) {
  await executor.execute(
    "UPDATE user_accounts SET password_hash = ?, updated_at = ? WHERE user_id = ? AND provider = 'password'",
    [passwordHash, now, userId],
  );
  await executor.execute('UPDATE users SET session_epoch = session_epoch + 1, updated_at = ? WHERE user_id = ?', [
    now,
    userId,
  ]);
}

/**
 * What the Settings page shows about an account (FR-SET-02).
 *
 * @param {number} userId
 * @returns {Promise<{ username: string, provider: 'password'|'google', email: string|null, emailVerifiedAt: Date|null } | null>}
 */
export async function findAccountSummary(userId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    `SELECT u.username, a.provider, a.email, a.email_verified_at, a.pending_email
       FROM users u JOIN user_accounts a ON a.user_id = u.user_id
      WHERE u.user_id = ? ORDER BY a.account_id LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    username: row.username,
    provider: row.provider,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    pendingEmail: row.pending_email,
  };
}

/**
 * A deletion request (FR-SET-07; SDD §5.5): the deletion state and its
 * deadline, with `session_epoch + 1` in the same statement — MySQL is the
 * session authority, so every session ends with the commit (V3).
 *
 * @param {object} request
 * @param {number} request.userId
 * @param {'soft'|'hard'} request.option
 * @param {Date} request.now
 * @param {Date} request.purgeAt soft: now + 30 days; hard: now
 * @returns {Promise<boolean>} false when the account was not in a normal state
 */
export async function requestAccountDeletion({ userId, option, now, purgeAt }, executor) {
  const [result] = await executor.execute(
    `UPDATE users
        SET deletion_state = ?, soft_deleted_at = ?, hard_delete_scheduled_at = ?,
            session_epoch = session_epoch + 1, updated_at = ?
      WHERE user_id = ? AND deletion_state = 'none'`,
    [option === 'soft' ? 'soft_deleted' : 'hard_delete_scheduled', option === 'soft' ? now : null, purgeAt, now, userId],
  );
  return result.affectedRows === 1;
}

/**
 * FR-SET-09: restore a soft-deleted account whose window is still open.
 *
 * @returns {Promise<boolean>} whether this call restored it
 */
export async function restoreSoftDeletedAccount(userId, now, executor) {
  const [result] = await executor.execute(
    `UPDATE users SET deletion_state = 'none', soft_deleted_at = NULL, hard_delete_scheduled_at = NULL, updated_at = ?
      WHERE user_id = ? AND deletion_state = 'soft_deleted' AND hard_delete_scheduled_at > ?`,
    [now, userId, now],
  );
  return result.affectedRows === 1;
}

/**
 * @param {number} userId
 * @returns {Promise<{ deletionState: string, hardDeleteScheduledAt: Date|null } | null>}
 */
export async function findDeletionState(userId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    'SELECT deletion_state, hard_delete_scheduled_at FROM users WHERE user_id = ?',
    [userId],
  );
  return rows.length === 0 ? null : { deletionState: rows[0].deletion_state, hardDeleteScheduledAt: rows[0].hard_delete_scheduled_at };
}

/**
 * The per-request session check's one primary-key read (V3).
 *
 * @param {number} userId
 * @param {import('./transaction.js').Executor} [executor]
 * @returns {Promise<{ username: string, sessionEpoch: number, deletionState: string } | null>}
 */
export async function findSessionAuthority(userId, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    'SELECT username, session_epoch, deletion_state FROM users WHERE user_id = ?',
    [userId],
  );
  if (rows.length === 0) return null;
  return { username: rows[0].username, sessionEpoch: Number(rows[0].session_epoch), deletionState: rows[0].deletion_state };
}
