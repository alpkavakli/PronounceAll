/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word slug normalisation and validation (FR-WORD-02).
 *
 * The `:word` path segment is normalised before lookup by lower-casing,
 * Unicode-NFC-normalising, and trimming surrounding whitespace; a slug carrying
 * any character outside the variant's allow-list is rejected outright. When the
 * input differs from the canonical form the caller 301-redirects to the
 * canonical URL rather than rendering on the denormalised one, which is what
 * keeps duplicate-content SEO penalties, cache fragmentation, and
 * control-character smuggling off the word page.
 *
 * The validators layer is pure: it returns a decision, and the route turns that
 * decision into a redirect, a 400, or a lookup (C4, §7.5).
 */

import { AppError } from '../errors/index.js';

/**
 * Per-variant allow-lists (FR-WORD-02).
 *
 * The allow-list is a property of the variant's orthography, so it is keyed by
 * variant code. It lives here rather than in `language_variants` because SDD
 * §4.2 fixes that table's four columns and the schema is frozen; a new variant
 * adds an entry here alongside its row, which is the one place the E1 "variant
 * is a data dimension" rule does not reach, since a character class is not
 * content. `en-us` is `[a-z]` plus hyphen and apostrophe, so `mother-in-law`
 * and `don't` are expressible.
 */
const VARIANT_ALLOWED_CHARACTERS = Object.freeze({
  'en-us': /^[a-z'-]+$/,
});

/** Applied to a variant with no explicit entry: the conservative Latin base. */
const DEFAULT_ALLOWED_CHARACTERS = /^[a-z'-]+$/;

/** The longest slug `words.normalized_headword` can hold (SDD §4.2). */
export const MAX_SLUG_LENGTH = 128;

/**
 * @param {string} variantCode
 * @returns {RegExp}
 */
function allowedCharactersFor(variantCode) {
  return (
    Object.hasOwn(VARIANT_ALLOWED_CHARACTERS, variantCode)
      ? VARIANT_ALLOWED_CHARACTERS[variantCode]
      : DEFAULT_ALLOWED_CHARACTERS
  );
}

/**
 * Reduce a raw slug to its canonical form. Applied before the allow-list check,
 * so `Cupcake` and `  cupcake  ` both canonicalise rather than being rejected.
 *
 * @param {string} raw the URL-decoded `:word` segment
 * @returns {string} the canonical slug
 */
export function canonicaliseSlug(raw) {
  // NFC first: composing before case folding keeps a decomposed input from
  // surviving the allow-list as a base letter plus a combining mark.
  return raw.normalize('NFC').trim().toLowerCase();
}

/**
 * @typedef {object} SlugDecision
 * @property {string} slug          the canonical slug to look up
 * @property {boolean} isCanonical  false when the caller must 301-redirect
 */

/**
 * Normalise and validate a raw word slug.
 *
 * @param {string} raw raw, URL-decoded `:word` segment
 * @param {string} variantCode the active variant, e.g. `en-us`
 * @returns {SlugDecision}
 * @throws {AppError} 400 when the slug carries a character outside the
 *   allow-list, which includes every control character (FR-WORD-02)
 */
export function normaliseWordSlug(raw, variantCode) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw AppError.validation('That is not a valid word.');
  }

  const slug = canonicaliseSlug(raw);

  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) {
    throw AppError.validation('That is not a valid word.');
  }

  if (!allowedCharactersFor(variantCode).test(slug)) {
    // Deliberately does not echo the rejected slug: the message is rendered
    // into a page, and a rejected slug is by definition unsanitised input.
    throw AppError.validation('That is not a valid word.');
  }

  return { slug, isCanonical: slug === raw };
}

export default normaliseWordSlug;
