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
import { listHeadwords } from '../repositories/words.repository.js';

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

/**
 * Every public content page, for the sitemap (FR-WORD-09): the landing page,
 * the legal pages, the IPA indexes, and each active variant's word pages at
 * their canonical URL. Account and practice pages are not content.
 *
 * @returns {Promise<string[]>} site-relative paths
 */
export async function listSitemapPaths() {
  const paths = ['/', '/learnIPA', '/privacy', '/kvkk'];
  for (const variant of await findActiveVariants()) {
    paths.push(`/${variant.code}/learnIPA`);
    for (const { normalizedHeadword } of await listHeadwords(variant.variantId)) {
      paths.push(`/${variant.code}/${encodeURIComponent(normalizedHeadword)}`);
    }
  }
  return paths;
}
