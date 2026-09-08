/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The single application error type (SDD v1.1 §6.1, decision C2).
 *
 * One error type, one middleware, two surfaces. `AppError` carries a stable
 * machine code, an HTTP status, a safe message intended for the user, the
 * underlying cause, and a metadata field for kind-specific data. A subclass
 * tree is deliberately avoided: what differs between error kinds is the status
 * and the surface, not behaviour.
 *
 * Services and repositories signal failure by throwing an `AppError` and never
 * by formatting a response, so the one error middleware can surface it on
 * either the HTML or the JSON path.
 */

/**
 * Stable machine error codes (SCREAMING_SNAKE_CASE per SDD v1.1 §7.2).
 * These are part of the contract with clients and must not be renamed casually.
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION: 'VALIDATION',
  AUTH: 'AUTH',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  WORD_NOT_FOUND: 'WORD_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT: 'RATE_LIMIT',
  INTERNAL: 'INTERNAL',
});

/**
 * The generic authentication failure message required by Foundational
 * Decisions §2. Never "user not found" and never "wrong password".
 */
export const GENERIC_AUTH_MESSAGE = 'Invalid credentials.';

export class AppError extends Error {
  /**
   * @param {object} options
   * @param {string} options.code stable machine code from {@link ERROR_CODES}
   * @param {number} options.status HTTP status code
   * @param {string} options.message safe message intended for the user
   * @param {unknown} [options.cause] underlying cause; logged, never serialised
   * @param {object} [options.meta] kind-specific data, e.g. `retryAfterSeconds`
   */
  constructor({ code, status, message, cause, meta = {} }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.meta = meta;
    Error.captureStackTrace?.(this, AppError);
  }

  /** @returns {boolean} true when `value` is an AppError, cross-realm safe. */
  static isAppError(value) {
    return value instanceof AppError;
  }

  /** Input rejected by the validators layer. HTTP 400. */
  static validation(message, { cause, meta } = {}) {
    return new AppError({
      code: ERROR_CODES.VALIDATION,
      status: 400,
      message,
      cause,
      meta,
    });
  }

  /**
   * Authentication failure. HTTP 401 with the generic message of Foundational
   * Decisions §2; the specific reason belongs in the log, never the response.
   */
  static auth({ cause, meta } = {}) {
    return new AppError({
      code: ERROR_CODES.AUTH,
      status: 401,
      message: GENERIC_AUTH_MESSAGE,
      cause,
      meta,
    });
  }

  /** Authenticated but not permitted. HTTP 403. */
  static forbidden(message = 'You do not have access to this resource.', { cause, meta } = {}) {
    return new AppError({
      code: ERROR_CODES.FORBIDDEN,
      status: 403,
      message,
      cause,
      meta,
    });
  }

  /**
   * Resource not found. HTTP 404.
   *
   * Word routes use the `WORD_NOT_FOUND` code instead, which the error
   * middleware surfaces as the styled fuzzy-suggestion page rather than a bare
   * 404 (FR-WORD-04, E3). That variant arrives with Iteration 1.
   */
  static notFound(message = 'That page could not be found.', { cause, meta } = {}) {
    return new AppError({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
      message,
      cause,
      meta,
    });
  }

  /** Username or email collision. HTTP 409. */
  static conflict(message, { cause, meta } = {}) {
    return new AppError({
      code: ERROR_CODES.CONFLICT,
      status: 409,
      message,
      cause,
      meta,
    });
  }

  /**
   * Rate limit exceeded. HTTP 429. The `Retry-After` value travels in metadata
   * and is written to the response header by the middleware (Foundational
   * Decisions §10.3).
   */
  static rateLimit(retryAfterSeconds, { cause } = {}) {
    return new AppError({
      code: ERROR_CODES.RATE_LIMIT,
      status: 429,
      message: 'Too many requests. Please wait a moment and try again.',
      cause,
      meta: { retryAfterSeconds },
    });
  }

  /** Unexpected failure. HTTP 500. Nothing beyond a safe message reaches the user. */
  static internal(cause) {
    return new AppError({
      code: ERROR_CODES.INTERNAL,
      status: 500,
      message: 'Something went wrong on our end. Please try again.',
      cause,
    });
  }
}

export default AppError;
