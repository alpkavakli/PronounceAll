/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The phoneme learning pages (FR-IPA-07, FR-IPA-10).
 *
 * Two URLs, deliberately distinct even though v1.0 renders the same rows behind
 * both:
 *
 *   `/:variant/learnIPA`  the inventory for ONE variant (FR-IPA-07);
 *   `/learnIPA`           the cross-variant index (FR-IPA-10).
 *
 * FR-IPA-10 explains why the second exists now rather than when a second variant
 * is seeded: locking the URL identity in v1.0 stops `/learnIPA` from meaning
 * "the English one" and then breaking every external link the day `en-gb`
 * arrives. It is reachable from the site FOOTER only — deliberately not linked
 * from word pages or from the per-variant page, because in v1.0 that link would
 * lead somewhere identical.
 *
 * ROUTING ORDER MATTERS. `/:variant/learnIPA` is indistinguishable from
 * `GET /:variant/:word`, so this router MUST be registered before the word
 * router or `learnIPA` is looked up as a word and 404s. Unlike `/search` — which
 * was given a top-level URL precisely to avoid this — the URL here is fixed by
 * FR-IPA-07, so the ordering is load-bearing and is pinned by a test.
 *
 * Both pages are uncached `private, no-store`: SDD §6.3 names the learning pages
 * among the responses B2 does NOT make cacheable, because FR-IPA-07 gives each
 * row a per-viewer save state.
 */

import { Router } from 'express';

import { config } from '../config/index.js';
import { listActiveVariants } from '../services/catalogue.service.js';
import { listGlobalInventory, listVariantInventory } from '../services/phoneme-page.service.js';
import { requireActiveVariant } from '../services/word-page.service.js';

/** The canonical spelling of the path segment, as FR-IPA-07 writes it. */
const SEGMENT = 'learnIPA';

/**
 * Send a differently-cased request to the canonical URL.
 *
 * Express matches paths case-insensitively by default, so `/en-us/learnipa`
 * already reaches this router — and would happily serve the page under a second
 * URL. That is the duplicate-content problem FR-WORD-02 exists to prevent for
 * words, so the same 301-to-canonical discipline is applied here rather than
 * letting two URLs render identical content.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} canonicalPath
 * @returns {boolean} true when a redirect was issued and the caller must stop
 */
function redirectedToCanonicalCase(req, res, canonicalPath) {
  if (req.path === canonicalPath) {
    return false;
  }
  res.redirect(301, canonicalPath);
  return true;
}

export function learnIpaRouter() {
  const router = Router();

  // FR-IPA-10, the cross-variant index.
  router.get(`/${SEGMENT}`, async (req, res, next) => {
    try {
      if (redirectedToCanonicalCase(req, res, `/${SEGMENT}`)) {
        return;
      }

      const [phonemes, variants] = await Promise.all([
        listGlobalInventory(),
        listActiveVariants(),
      ]);

      res.render('learn-ipa', {
        scope: 'global',
        variant: null,
        variants,
        phonemes,
        // The view emits an <audio> src for any unit whose asset is ready, so
        // the prefix must be present on EVERY render, not only where audio
        // happens to exist today (V4).
        audioPublicPrefix: config.audio.publicPrefix,
        title: 'Learn IPA',
      });
    } catch (error) {
      next(error);
    }
  });

  // FR-IPA-07, one variant's inventory.
  router.get(`/:variant/${SEGMENT}`, async (req, res, next) => {
    try {
      // Resolve the variant BEFORE redirecting, so an unsupported variant is a
      // 404 rather than a redirect to a URL that will 404 anyway (FR-WORD-01's
      // rule: the variant is validated before anything else happens).
      const variant = await requireActiveVariant(req.params.variant);

      if (redirectedToCanonicalCase(req, res, `/${variant.code}/${SEGMENT}`)) {
        return;
      }

      const phonemes = await listVariantInventory(variant);

      res.render('learn-ipa', {
        scope: 'variant',
        variant,
        variants: [variant],
        phonemes,
        audioPublicPrefix: config.audio.publicPrefix,
        title: `Learn IPA — ${variant.displayName}`,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default learnIpaRouter;
