/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The word-request form (FR-WORD-05).
 *
 * The form captures ONLY the variant and the requested word. No personal data
 * is accepted, so no personal data can be stored: the submitter is identified
 * solely by the `pa_uid` cookie the middleware already resolved, and the schema
 * below has no field through which anything else could arrive (SRS Appendix E).
 *
 * Zod is already a project dependency and the validators layer is where input
 * shape is decided (C4, §7.5). The slug itself is normalised by the shared
 * `word-slug` validator, so a request and a page lookup canonicalise a word
 * identically and a request can never be filed against a slug the word page
 * would have rejected.
 */

import { z } from 'zod';

import { AppError } from '../errors/index.js';
import { MAX_SLUG_LENGTH, normaliseWordSlug } from './word-slug.validator.js';

/**
 * The Turnstile field name is fixed by Cloudflare's widget, which posts the
 * token under exactly this key.
 */
export const TURNSTILE_FIELD = 'cf-turnstile-response';

const schema = z.object({
  variant: z.string().min(1).max(16),
  word: z.string().min(1).max(MAX_SLUG_LENGTH),
  [TURNSTILE_FIELD]: z.string().max(4096).optional(),
});

/**
 * @typedef {object} WordRequestInput
 * @property {string} variantCode
 * @property {string} slug            canonical, ready for the unique key
 * @property {string} turnstileToken  empty string when the form sent none
 */

/**
 * Validate and normalise a word-request submission.
 *
 * @param {unknown} body the parsed request body
 * @returns {WordRequestInput}
 * @throws {AppError} 400 when the shape or the slug is invalid
 */
export function parseWordRequest(body) {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw AppError.validation('That word request could not be read.', {
      cause: parsed.error,
    });
  }

  const { slug } = normaliseWordSlug(parsed.data.word, parsed.data.variant);

  return {
    variantCode: parsed.data.variant,
    slug,
    turnstileToken: parsed.data[TURNSTILE_FIELD] ?? '',
  };
}

export default parseWordRequest;
