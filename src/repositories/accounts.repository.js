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
  }
  throw error;
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
