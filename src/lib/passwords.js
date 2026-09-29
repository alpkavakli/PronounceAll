/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Password hashing (FR-AUTH-08, FR-AUTH-13).
 *
 * bcrypt at cost 12, `$2b$` hashes. A password is never logged, stored or
 * returned in any other form.
 *
 * {@link verifyPassword} always runs one bcrypt comparison, even when there is
 * no account to compare against: an unknown username is checked against a
 * fixed dummy hash, so its response time matches a wrong password on a real
 * account (FR-AUTH-13).
 */

import bcrypt from 'bcrypt';

export const BCRYPT_COST = 12;

/** A valid cost-12 hash of a random value no one knows; used only to spend time. */
const DUMMY_HASH = bcrypt.hashSync(`unused-${process.pid}-${Date.now()}`, BCRYPT_COST);

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * @param {string} password
 * @param {string|null|undefined} hash the stored hash, or nothing for an unknown account
 * @returns {Promise<boolean>} false whenever there is no hash
 */
export async function verifyPassword(password, hash) {
  const matched = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && matched;
}
