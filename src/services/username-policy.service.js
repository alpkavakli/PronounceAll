/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The username policy (FR-AUTH-05, SRS Appendix A, V8).
 *
 * 3–20 characters from `[a-zA-Z0-9_-]`, beginning with a letter; not reserved;
 * not profane. Stored as typed, compared lower-cased — uniqueness itself is the
 * database's `username_lower` key, not a check here.
 *
 * The profanity filter is `obscenity`, kept behind this module so it can be
 * replaced without touching callers (V8). Usernames are a hostile surface, so
 * the package's recommended transformers (leetspeak, repeated characters) run.
 */

import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity';

import { RESERVED_USERNAMES } from '../config/reserved-usernames.js';
import { AppError } from '../errors/index.js';

const SHAPE = /^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/;
const VARIANT_CODE = /^[a-z]{2}-[a-z]{2}$/i;
const RESERVED = new Set(RESERVED_USERNAMES);

const profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/**
 * @param {unknown} username
 * @returns {string|null} why the username is refused, or null when it is acceptable
 */
export function usernameProblem(username) {
  if (typeof username !== 'string' || username.length === 0) return 'Choose a username.';
  if (username.length < 3 || username.length > 20) return 'Usernames are 3 to 20 characters long.';
  if (!/^[a-zA-Z]/.test(username)) return 'Usernames begin with a letter.';
  if (!SHAPE.test(username)) return 'Usernames use only letters, digits, “_” and “-”.';
  const lowered = username.toLowerCase();
  if (RESERVED.has(lowered) || VARIANT_CODE.test(lowered) || profanity.hasMatch(lowered)) {
    return 'That username is not available.';
  }
  return null;
}

/**
 * @param {unknown} username
 * @returns {string} the username, as typed
 * @throws {AppError} 400 with the reason
 */
export function requireAcceptableUsername(username) {
  const problem = usernameProblem(username);
  if (problem) throw AppError.validation(problem);
  return /** @type {string} */ (username);
}
