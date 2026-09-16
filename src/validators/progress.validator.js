/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Input validation for the progress endpoints: the hydration read and the save
 * and tag write (FR-SAVE-01, FR-SAVE-02, FR-SAVE-08; SDD v1.1 §7.5).
 */

import { z } from 'zod';

import { AppError } from '../errors/index.js';
import { MAX_TARGETS_PER_KIND } from '../services/viewer-state.service.js';

/** A comma-separated list of positive integer ids, possibly empty. */
const idList = z
  .string()
  .max(4096)
  .optional()
  .transform((value, context) => {
    if (!value) return [];
    const ids = [...new Set(value.split(','))].map(Number);
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      context.addIssue({ code: 'custom', message: 'ids must be positive integers' });
      return z.NEVER;
    }
    if (ids.length > MAX_TARGETS_PER_KIND) {
      context.addIssue({ code: 'custom', message: 'too many ids' });
      return z.NEVER;
    }
    return ids;
  });

const viewerStateSchema = z.object({
  variant: z.string().min(1).max(16),
  words: idList,
  phonemes: idList,
});

/**
 * @param {unknown} query
 * @returns {{ variantCode: string, wordIds: number[], phonemeIds: number[] }}
 */
export function parseViewerStateQuery(query) {
  const parsed = viewerStateSchema.safeParse(query);
  if (!parsed.success) {
    throw AppError.validation('That request could not be read.', { cause: parsed.error });
  }
  return { variantCode: parsed.data.variant, wordIds: parsed.data.words, phonemeIds: parsed.data.phonemes };
}

/**
 * A client idempotency key: an opaque URL-safe token. The server only keys a
 * short-lived reservation on it, so its entropy is the client's concern, but
 * its size and alphabet are bounded here.
 */
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

const saveSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['save', 'unsave']),
    targetKind: z.enum(['word', 'phoneme']),
    targetId: z.coerce.number().int().positive(),
    idempotencyKey,
  }),
  z.object({
    action: z.literal('tag'),
    targetKind: z.enum(['word', 'phoneme']),
    targetId: z.coerce.number().int().positive(),
    // `none` resets to untagged saved (FR-SAVE-02).
    tag: z.enum(['none', 'learning', 'learned']),
    idempotencyKey,
  }),
]);

/**
 * @param {unknown} body
 * @returns {{ action: 'save'|'unsave'|'tag', targetKind: 'word'|'phoneme', targetId: number, tag: null|'learning'|'learned', idempotencyKey: string }}
 */
export function parseSaveRequest(body) {
  // The form also carries `_csrf` and `returnTo`, consumed by the middleware and
  // the route; the save schema sees only the save fields.
  const { _csrf, returnTo, ...fields } = body && typeof body === 'object' ? body : {};
  const parsed = saveSchema.safeParse(fields);
  if (!parsed.success) {
    throw AppError.validation('That change could not be read.', { cause: parsed.error });
  }
  const { tag, ...rest } = parsed.data;
  return { ...rest, tag: tag === undefined || tag === 'none' ? null : tag };
}

/**
 * A backslash (which browsers read as a slash) or an ASCII control character.
 *
 * @param {string} value
 * @returns {boolean}
 */
function hasUnsafeCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === String.fromCharCode(92) || code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * A same-site relative return path, or `/` (FR-SAVE-07, SDD v1.1 §6.6).
 *
 * Accepts only a path with a single leading `/`: never a scheme, an authority
 * (`//host`), a backslash that browsers treat as a slash, or a control
 * character. Anything else returns to the home page, so the confirmation flow
 * cannot become an open redirect.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function safeReturnPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || hasUnsafeCharacter(raw)) return '/';
  const base = 'http://return.invalid';
  const resolved = new URL(raw, base);
  if (resolved.origin !== base) return '/';
  return `${resolved.pathname}${resolved.search}`;
}

const confirmSchema = z.object({
  kind: z.enum(['word', 'phoneme']),
  id: z.coerce.number().int().positive(),
  return: z.string().max(512).optional(),
});

/**
 * @param {unknown} query
 * @returns {{ targetKind: 'word'|'phoneme', targetId: number, returnTo: string }}
 */
export function parseConfirmQuery(query) {
  const parsed = confirmSchema.safeParse(query);
  if (!parsed.success) {
    throw AppError.validation('That request could not be read.', { cause: parsed.error });
  }
  return { targetKind: parsed.data.kind, targetId: parsed.data.id, returnTo: safeReturnPath(parsed.data.return) };
}

const listenSchema = z.object({
  targetKind: z.enum(['word', 'phoneme']),
  targetId: z.coerce.number().int().positive(),
});

/**
 * @param {unknown} body
 * @returns {{ targetKind: 'word'|'phoneme', targetId: number }}
 */
export function parseListenRequest(body) {
  const parsed = listenSchema.safeParse(body);
  if (!parsed.success) {
    throw AppError.validation('That request could not be read.', { cause: parsed.error });
  }
  return parsed.data;
}
