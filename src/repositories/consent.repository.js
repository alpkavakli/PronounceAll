/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Consent records for either owner (FR-CONSENT-03, FR-SET-04, FR-SET-10;
 * SDD v1.1 §4.7).
 *
 * Append-only by use: a change of mind is a new row, and the latest row per
 * owner and type is the one that counts, read through the
 * `(owner, consent_type, recorded_at)` indexes in one lookup.
 */

import { defaultExecutor } from './transaction.js';

/** @typedef {{ userId: number } | { anonymousId: string }} Owner */

const LATEST = Object.freeze({
  user: `SELECT consent_value FROM consent_records WHERE user_id = ? AND consent_type = ?
          ORDER BY recorded_at DESC, consent_id DESC LIMIT 1`,
  anonymous: `SELECT consent_value FROM consent_records WHERE anonymous_id = ? AND consent_type = ?
               ORDER BY recorded_at DESC, consent_id DESC LIMIT 1`,
});

/**
 * @param {Owner} owner
 * @param {'ads_opt_in'|'no_recovery_ack'|'account_restored'} consentType
 * @returns {Promise<'granted'|'revoked'|'acknowledged'|null>} the latest value, if any
 */
export async function findLatestConsent(owner, consentType, executor = defaultExecutor()) {
  const [rows] = 'userId' in owner
    ? await executor.execute(LATEST.user, [owner.userId, consentType])
    : await executor.execute(LATEST.anonymous, [owner.anonymousId, consentType]);
  return rows.length === 0 ? null : rows[0].consent_value;
}

/**
 * @param {object} record
 * @param {Owner} record.owner
 * @param {'ads_opt_in'|'no_recovery_ack'|'account_restored'} record.consentType
 * @param {'granted'|'revoked'|'acknowledged'} record.consentValue
 * @param {string|null} [record.policyVersion] required for `ads_opt_in` (CHECK)
 * @param {Date} record.now
 */
export async function insertConsent({ owner, consentType, consentValue, policyVersion = null, now }, executor = defaultExecutor()) {
  await executor.execute(
    `INSERT INTO consent_records (user_id, anonymous_id, consent_type, consent_value, policy_version, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    ['userId' in owner ? owner.userId : null, 'anonymousId' in owner ? owner.anonymousId : null, consentType, consentValue, policyVersion, now],
  );
}
