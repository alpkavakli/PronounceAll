/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Catalogue read operations (SDD v1.1 §4.2).
 *
 * Services depend on repositories (C4); the repository owns the SQL and this
 * layer owns the domain meaning. No Express types and no infrastructure client
 * appear here.
 */

import {
  findActiveVariants,
  findVariantByCode,
} from '../repositories/language-variants.repository.js';

/**
 * @returns {Promise<import('../repositories/language-variants.repository.js').LanguageVariant[]>}
 */
export async function listActiveVariants() {
  return findActiveVariants();
}

/**
 * Resolve a variant code from a URL segment. Only an active variant resolves,
 * so a seeded-but-disabled variant is not reachable from the web.
 *
 * @param {string} code
 * @returns {Promise<import('../repositories/language-variants.repository.js').LanguageVariant | null>}
 */
export async function resolveActiveVariant(code) {
  const variant = await findVariantByCode(code);
  return variant?.isActive ? variant : null;
}
