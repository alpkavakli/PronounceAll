/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word-request capture (FR-WORD-05, SDD v1.1 §4.2).
 *
 * The domain rules of the endpoint live here rather than in the route: the
 * Turnstile gate, the check that the word is genuinely missing, and the
 * duplicate up-vote. The rate limit is enforced upstream as middleware, because
 * it is a property of the transport rather than of the request's meaning.
 *
 * The Turnstile verifier is INJECTED (C4): this service depends on a function,
 * not on the Cloudflare client, so it stays testable without a network and
 * carries no infrastructure import.
 */

import { AppError } from '../errors/index.js';
import {
  findWordByHeadword,
} from '../repositories/words.repository.js';
import { recordWordRequest } from '../repositories/word-requests.repository.js';
import { requireActiveVariant } from './word-page.service.js';

/**
 * @typedef {object} WordRequestResult
 * @property {string} slug
 * @property {boolean} created    false when an existing request was up-voted
 * @property {boolean} alreadyInDictionary
 */

/**
 * Record a request for a missing word.
 *
 * @param {object} input from `parseWordRequest`
 * @param {object} options
 * @param {(token: string, remoteIp?: string) => Promise<{ success: boolean }>}
 *   options.verifyTurnstile the injected Turnstile port
 * @param {string | null} options.anonymousId the `pa_uid` UUID
 * @param {string} [options.remoteIp]
 * @returns {Promise<WordRequestResult>}
 * @throws {AppError} 400 on a missing or invalid Turnstile token; 404 on an
 *   unsupported variant
 */
export async function submitWordRequest(input, { verifyTurnstile, anonymousId, remoteIp }) {
  // FR-WORD-05: submissions without a valid Turnstile token are rejected with
  // 400. Checked before any write, so a rejected submission leaves no row.
  const verification = await verifyTurnstile(input.turnstileToken, remoteIp);
  if (!verification.success) {
    throw AppError.validation('Please complete the verification challenge and try again.');
  }

  const variant = await requireActiveVariant(input.variantCode);

  // A word that has since been seeded needs no request. Reported rather than
  // recorded, so the maintainer's `word_requests` backlog stays a list of
  // genuine gaps (FR-CONTENT-07).
  const existing = await findWordByHeadword(variant.variantId, input.slug);
  if (existing) {
    return { slug: input.slug, created: false, alreadyInDictionary: true };
  }

  // One statement: a duplicate becomes an up-vote rather than a second row, and
  // two concurrent submissions of the same new word cannot both insert
  // (FR-WORD-05). No transaction is opened, because a single upsert is already
  // atomic and there is nothing else in the boundary.
  const outcome = await recordWordRequest({
    variantId: variant.variantId,
    normalizedWord: input.slug,
    submittedByAnonymousId: anonymousId,
    // Always null in Iteration 1: there is no `users` table yet, and the
    // column carries no foreign key until the authentication iteration.
    submittedByUserId: null,
  });

  return { slug: input.slug, created: outcome.created, alreadyInDictionary: false };
}

export default submitWordRequest;
