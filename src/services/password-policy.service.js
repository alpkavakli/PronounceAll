/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The password policy (FR-AUTH-07), shared by every path that sets a password:
 * registration and password reset.
 *
 * 8–100 characters, no composition rules, then the breached-password check by
 * k-anonymity. The check fails closed: when it cannot run, no password is
 * accepted, and the failure is reported as the service's — a temporary one —
 * never as a fault in the password. Only the error's kind is logged; never the
 * password, its hash, or the API's response.
 */

import { AppError } from '../errors/index.js';
import { logger } from '../lib/logger.js';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 100;

export const BREACHED_PASSWORD_MESSAGE =
  'This password has appeared in a known breach; please choose another.';

export const PASSWORD_CHECK_UNAVAILABLE_MESSAGE =
  "We couldn't verify this password right now. Please try again shortly.";

/**
 * @param {object} dependencies
 * @param {(password: string) => Promise<boolean>} dependencies.isBreachedPassword
 */
export function createPasswordPolicy({ isBreachedPassword }) {
  /**
   * @param {unknown} password
   * @returns {Promise<string>} the password, once acceptable
   * @throws {AppError} 400 for a length or breach refusal; 503 when the check cannot run
   */
  async function requireAcceptablePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
      throw AppError.validation(`Passwords are at least ${PASSWORD_MIN_LENGTH} characters long.`);
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      throw AppError.validation(`Passwords are at most ${PASSWORD_MAX_LENGTH} characters long.`);
    }
    let breached;
    try {
      breached = await isBreachedPassword(password);
    } catch (cause) {
      logger.warn({ reason: cause?.name ?? 'Error' }, 'Breached-password check unavailable; password refused');
      throw AppError.unavailable(PASSWORD_CHECK_UNAVAILABLE_MESSAGE);
    }
    if (breached) throw AppError.validation(BREACHED_PASSWORD_MESSAGE);
    return password;
  }

  return { requireAcceptablePassword };
}
