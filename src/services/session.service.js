/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Registered sessions (FR-AUTH-12, V3; SDD v1.1 §4.10).
 *
 * Redis holds the session; MySQL `users.session_epoch` decides whether it is
 * still valid. On every authenticated request the stored epoch is compared with
 * the authoritative one, a single primary-key read, and any mismatch fails
 * closed. That comparison is what makes a password change or reset end every
 * session at once (FR-AUTH-11): the epoch moves and every older record stops
 * authorising, whether or not its Redis key has been cleaned up yet.
 *
 * Login race (V3): a session is created only after re-reading the epoch the
 * credentials were validated against. A change landing between that re-read and
 * the Redis write leaves a record that can never authorise, because the
 * per-request comparison rejects it.
 */

import { AppError } from '../errors/index.js';
import { generateSecureToken } from '../lib/ids.js';
import { findSessionAuthority } from '../repositories/accounts.repository.js';

/** FR-AUTH-12. */
export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;

/** 256 bits from the CSPRNG (NFR-SEC-12). */
const SESSION_ID_BYTES = 32;

/**
 * @typedef {{ sessionId: string, userId: number, username: string }} ActiveSession
 */

/**
 * @param {object} dependencies
 * @param {ReturnType<import('../lib/session-store.js').createSessionStore>} dependencies.store
 * @param {() => number} [dependencies.now] epoch milliseconds
 */
export function createSessionService({ store, now = Date.now }) {
  /** The key lives no longer than either deadline. */
  const ttlFor = (absoluteExpiresAt) =>
    Math.max(1, Math.min(SESSION_IDLE_SECONDS, Math.ceil((absoluteExpiresAt - now()) / 1000)));

  /**
   * Start a fresh session for credentials validated against `validatedEpoch`.
   * A new id every time: this is the rotation FR-AUTH-12 requires on login.
   *
   * @param {number} userId
   * @param {number} validatedEpoch
   * @returns {Promise<string>} the new `pa_sid` value
   */
  async function startSession(userId, validatedEpoch) {
    const authority = await findSessionAuthority(userId);
    if (!authority || authority.deletionState !== 'none' || authority.sessionEpoch !== validatedEpoch) {
      throw AppError.auth();
    }
    const sessionId = generateSecureToken(SESSION_ID_BYTES);
    const absoluteExpiresAt = now() + SESSION_ABSOLUTE_SECONDS * 1000;
    await store.create(sessionId, { userId, sessionEpoch: validatedEpoch, absoluteExpiresAt }, ttlFor(absoluteExpiresAt));
    return sessionId;
  }

  /**
   * Validate the session a request carries, and slide its idle window.
   *
   * @param {string|undefined} sessionId
   * @returns {Promise<ActiveSession|null>} null for anything that does not authorise
   */
  async function resolveSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) return null;

    const record = await store.read(sessionId);
    if (!record) return null;

    if (now() >= record.absoluteExpiresAt) {
      await store.destroy(sessionId, record.userId);
      return null;
    }

    const authority = await findSessionAuthority(record.userId);
    if (!authority || authority.deletionState !== 'none' || authority.sessionEpoch !== record.sessionEpoch) {
      await store.destroy(sessionId, record.userId);
      return null;
    }

    await store.touch(sessionId, ttlFor(record.absoluteExpiresAt));
    return { sessionId, userId: record.userId, username: authority.username };
  }

  /** @param {ActiveSession} session */
  async function endSession(session) {
    await store.destroy(session.sessionId, session.userId);
  }

  return { startSession, resolveSession, endSession };
}
