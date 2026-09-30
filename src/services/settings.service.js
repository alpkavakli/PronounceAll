/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Settings page's data and the cookie preferences (FR-SET-01/03/04/05/10,
 * FR-CONSENT-03; SDD v1.1 §4.7).
 *
 * Cookie categories: the strictly necessary ones (`pa_uid`, `pa_sid`) cannot
 * be switched off — a request that tries is refused — and the one optional
 * category, ads, is off until the viewer opts in. Every change of the ads
 * choice appends a consent record with the policy version in effect; the
 * latest record is the answer. No ad network is wired up in v1.0 and no ad
 * cookie exists, so revoking has nothing to clear yet.
 */

import { AppError } from '../errors/index.js';
import { findAccountSummary } from '../repositories/accounts.repository.js';
import { findLatestConsent, insertConsent } from '../repositories/consent.repository.js';
import { touchAnonymousProfile } from '../repositories/progress.repository.js';
import { withTransaction } from '../repositories/transaction.js';

/** The strictly necessary cookies, with why each is needed (FR-SET-03, Appendix D). */
export const ESSENTIAL_COOKIES = Object.freeze([
  Object.freeze({
    name: 'pa_uid',
    purpose: 'Remembers your saved words and sounds on this browser, with or without an account.',
  }),
  Object.freeze({
    name: 'pa_sid',
    purpose: 'Keeps you signed in. Set only when you sign in; it ends after 30 idle minutes or 12 hours.',
  }),
]);

/** The variants the selector offers (FR-SET-05): only American English in v1.0. */
export const LANGUAGE_VARIANTS = Object.freeze([Object.freeze({ code: 'en-us', name: 'American English' })]);

/** @typedef {{ userId: number } | { anonymousId: string }} Owner */

/**
 * FR-CONSENT-03: the ad-serving decision. True only when the latest record
 * for this owner is `granted`. Nothing serves ads in v1.0; this is the one
 * place that decision will be read.
 *
 * @param {Owner|null} owner
 * @returns {Promise<boolean>}
 */
export async function adsConsentGranted(owner) {
  if (!owner) return false;
  return (await findLatestConsent(owner, 'ads_opt_in')) === 'granted';
}

/**
 * @param {object} dependencies
 * @param {string} dependencies.privacyPolicyVersion
 * @param {() => Date} [dependencies.clock]
 */
export function createSettingsService({ privacyPolicyVersion, clock = () => new Date() }) {
  /**
   * @param {{ userId: number|null, anonymousId: string|null }} viewer
   */
  async function describe({ userId, anonymousId }) {
    const owner = userId !== null ? { userId } : anonymousId ? { anonymousId } : null;
    return {
      account: userId !== null ? await findAccountSummary(userId) : null,
      adsEnabled: await adsConsentGranted(owner),
      essentialCookies: ESSENTIAL_COOKIES,
      languageVariants: LANGUAGE_VARIANTS,
    };
  }

  /**
   * Save the cookie preferences (FR-SET-03/04, FR-CONSENT-03).
   *
   * @param {{ userId: number|null, anonymousId: string }} viewer
   * @param {Record<string, unknown>} form the submitted fields
   * @returns {Promise<{ changed: boolean }>}
   * @throws {AppError} 400 when the request tries to switch off an essential cookie
   */
  async function saveCookiePreferences({ userId, anonymousId }, form) {
    // FR-SET-03: an essential cookie is not the viewer's to switch off. The
    // page never offers it; a request that asks anyway is refused.
    for (const { name } of ESSENTIAL_COOKIES) {
      if (name in form && form[name] !== 'on') {
        throw AppError.validation('Strictly necessary cookies cannot be turned off.');
      }
    }
    const wantsAds = form.ads === 'on';
    const owner = userId !== null ? { userId } : { anonymousId };

    return withTransaction(async (tx) => {
      const now = clock();
      const current = (await findLatestConsent(owner, 'ads_opt_in', tx)) === 'granted';
      if (current === wantsAds) return { changed: false };
      // Only a change is written. An anonymous change is a deliberate write:
      // it creates the profile the record belongs to (FR-AUTH-03, FR-SET-10).
      if ('anonymousId' in owner) await touchAnonymousProfile(owner.anonymousId, now, tx);
      await insertConsent(
        {
          owner,
          consentType: 'ads_opt_in',
          consentValue: wantsAds ? 'granted' : 'revoked',
          policyVersion: privacyPolicyVersion,
          now,
        },
        tx,
      );
      return { changed: true };
    });
  }

  return { describe, saveCookiePreferences };
}
