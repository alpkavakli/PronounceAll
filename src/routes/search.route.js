/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word search (FIND-10).
 *
 * Implemented ahead of the specification; see `word-search.service.js` and the
 * `FIND-10` register entry for what the SRS still owes.
 *
 * The route is top-level `GET /search` with the variant as a query parameter,
 * deliberately NOT `/:variant/search`. The latter is indistinguishable from
 * `GET /:variant/:word` and would work only for as long as the search router
 * stayed registered first — a silent break waiting for someone to reorder the
 * composition root.
 *
 * Thin per C4: resolve the variant, call one service, render or redirect.
 */

import { Router } from 'express';

import { requireActiveVariant } from '../services/word-page.service.js';
import { searchWords } from '../services/word-search.service.js';

/** The variant used when the query names none, matching the v1.0 default. */
const DEFAULT_VARIANT = 'en-us';

export function searchRouter() {
  const router = Router();

  router.get('/search', async (req, res, next) => {
    try {
      const variantCode =
        typeof req.query.variant === 'string' && req.query.variant !== ''
          ? req.query.variant
          : DEFAULT_VARIANT;

      // FR-WORD-01's rule holds here too: the variant is validated against
      // `language_variants` before anything is looked up, and an unsupported
      // one is a 404 rather than a silent fall back to `en-us`.
      const variant = await requireActiveVariant(variantCode);
      const outcome = await searchWords(variant, req.query.q);

      // An exact hit belongs at the word's own URL, not on a results page that
      // lists one item. 302 rather than 301: the mapping from a query to a word
      // is not permanent, and a cached permanent redirect on `/search?q=…`
      // would be a nuisance to undo.
      if (outcome.kind === 'exact') {
        res.redirect(302, `/${variant.code}/${encodeURIComponent(outcome.slug)}`);
        return;
      }

      // Left in the default DYNAMIC response class. Results are not per-viewer,
      // so they could be shared, but a query string makes an edge cache key per
      // query for little gain; B2's cacheable shell stays reserved for word
      // pages.
      res.render('search', {
        variant,
        query: outcome.query,
        rawQuery: typeof req.query.q === 'string' ? req.query.q : '',
        kind: outcome.kind,
        suggestions: outcome.suggestions ?? [],
        title: outcome.query ? `Search: ${outcome.query}` : 'Search',
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default searchRouter;
