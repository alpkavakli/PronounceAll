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
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    throw AppError.validation('That change could not be read.', { cause: parsed.error });
  }
  const { tag, ...rest } = parsed.data;
  return { ...rest, tag: tag === undefined || tag === 'none' ? null : tag };
}
