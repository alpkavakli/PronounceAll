/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Single-use email-verification and password-reset tokens (FR-AUTH-09/10/11,
 * NFR-SEC-10, NFR-SEC-12; SDD v1.1 §4.3).
 *
 * Only the SHA-256 of a token is ever stored or queried; the raw token exists
 * in the emailed link alone. Consumption is `consumed_at`, set once. Issuing a
 * new token of a type first marks every open one of that type consumed, which
 * is how "each new link invalidates the previous ones" holds.
 */

import { defaultExecutor } from './transaction.js';

/** @typedef {'email_verification'|'password_reset'} TokenType */

/**
 * Close every open token of a type for a user (FR-AUTH-10, FR-AUTH-11).
 *
 * @param {object} scope
 * @param {number} scope.userId
 * @param {TokenType} scope.tokenType
 * @param {Date} scope.now
 * @param {import('./transaction.js').Executor} [executor]
 */
export async function closeOpenTokens({ userId, tokenType, now }, executor = defaultExecutor()) {
  await executor.execute(
    `UPDATE auth_tokens SET consumed_at = ?
      WHERE user_id = ? AND token_type = ? AND consumed_at IS NULL`,
    [now, userId, tokenType],
  );
}

/**
 * @param {object} token
 * @param {number} token.userId
 * @param {TokenType} token.tokenType
 * @param {string} token.tokenHash SHA-256 hex
 * @param {Date} token.expiresAt
 * @param {Date} token.now
 * @param {import('./transaction.js').Executor} [executor]
 */
export async function insertAuthToken({ userId, tokenType, tokenHash, expiresAt, now }, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, tokenType, tokenHash, expiresAt, now],
  );
}

/**
 * Find a token by its hash, locking it inside the caller's transaction so two
 * concurrent uses serialise and only one can consume it.
 *
 * @param {string} tokenHash
 * @param {TokenType} tokenType
 * @param {import('./transaction.js').Executor} executor a transaction connection
 * @returns {Promise<{ tokenId: number, userId: number, expiresAt: Date, consumedAt: Date|null } | null>}
 */
export async function lockTokenByHash(tokenHash, tokenType, executor) {
  const [rows] = await executor.execute(
    `SELECT token_id, user_id, expires_at, consumed_at FROM auth_tokens
      WHERE token_hash = ? AND token_type = ? FOR UPDATE`,
    [tokenHash, tokenType],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    tokenId: Number(row.token_id),
    userId: Number(row.user_id),
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

/**
 * The same lookup without a lock, for showing a form before any change.
 *
 * @param {string} tokenHash
 * @param {TokenType} tokenType
 * @param {import('./transaction.js').Executor} [executor]
 */
export async function findTokenByHash(tokenHash, tokenType, executor = defaultExecutor()) {
  const [rows] = await executor.execute(
    'SELECT token_id, user_id, expires_at, consumed_at FROM auth_tokens WHERE token_hash = ? AND token_type = ?',
    [tokenHash, tokenType],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return { tokenId: Number(row.token_id), userId: Number(row.user_id), expiresAt: row.expires_at, consumedAt: row.consumed_at };
}

/**
 * @param {number} tokenId
 * @param {Date} now
 * @param {import('./transaction.js').Executor} executor
 */
export async function consumeToken(tokenId, now, executor) {
  await executor.execute('UPDATE auth_tokens SET consumed_at = ? WHERE token_id = ? AND consumed_at IS NULL', [
    now,
    tokenId,
  ]);
}
