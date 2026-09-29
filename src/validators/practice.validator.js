/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Input validation for a practice answer (FR-PRACTICE-03; SDD v1.1 §7.5).
 */

import { z } from 'zod';

import { AppError } from '../errors/index.js';

const answerSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
  turnSeq: z.coerce.number().int().min(0),
  rating: z.enum(['right', 'wrong']),
});

/**
 * @param {unknown} body
 * @returns {{ sessionId: number, turnSeq: number, rating: 'right'|'wrong' }}
 */
export function parsePracticeAnswer(body) {
  const parsed = answerSchema.safeParse(body && typeof body === 'object' ? body : {});
  if (!parsed.success) throw AppError.validation('That answer could not be read.', { cause: parsed.error });
  return parsed.data;
}
