/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Have I Been Pwned range API (FR-AUTH-07; SDD v1.1 §2.2).
 *
 * k-anonymity: only the first five hex characters of the password's SHA-1 leave
 * the server. The remaining 35 are compared locally against the returned list.
 * `Add-Padding` asks the API to pad its response with zero-count entries, so the
 * response size does not reveal the prefix's bucket; those entries are ignored.
 *
 * Neither the prefix nor the response is ever logged (NFR-SEC-10).
 */

import { createHash } from 'node:crypto';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/**
 * @param {string} password
 * @returns {{ prefix: string, suffix: string }} upper-case hex halves of the SHA-1
 */
export function splitPasswordHash(password) {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @returns {(password: string) => Promise<boolean>} whether the password appears in a known breach
 * @throws when the API cannot be reached or answers with an error
 */
export function createHibpChecker({ fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  return async function isBreachedPassword(password) {
    const { prefix, suffix } = splitPasswordHash(password);
    const response = await fetchImpl(`${RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'PronounceAll' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HIBP range API answered ${response.status}`);

    const body = await response.text();
    for (const line of body.split('\n')) {
      const [candidate, count] = line.trim().split(':');
      if (candidate === suffix && Number(count) >= 1) return true;
    }
    return false;
  };
}
