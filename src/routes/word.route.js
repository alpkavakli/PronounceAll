/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word-page routes (FR-WORD-01/02/03/04/05/09, decisions B2, E3, SDD §5.3).
 *
 * Routes are thin (C4): they normalise input through the validators layer, call
 * one service, choose a response class, and render. Every failure is thrown for
 * the single error middleware to surface — a route never formats an error.
 */

import { Router } from 'express';

import { config } from '../config/index.js';
import { markCacheableShell } from '../middleware/response-class.js';
import { getWordPage, requireActiveVariant } from '../services/word-page.service.js';
import { submitWordRequest } from '../services/word-request.service.js';
import { parseWordRequest } from '../validators/word-request.validator.js';
import { normaliseWordSlug } from '../validators/word-slug.validator.js';

/**
 * FR-WORD-09: the `<title>` form is fixed by the requirement.
 *
 * @param {string} displayHeadword
 * @param {string} variantDisplayName
 * @returns {string}
 */
function pageTitle(displayHeadword, variantDisplayName) {
  return `${displayHeadword} — ${variantDisplayName} pronunciation`;
}

/** FR-WORD-09: the meta description is the meaning, capped at 160 characters. */
function metaDescription(meaning) {
  const collapsed = meaning.replace(/\s+/g, ' ').trim();
  return collapsed.length <= 160 ? collapsed : `${collapsed.slice(0, 157).trimEnd()}…`;
}

/**
 * The human-readable name of the upstream source, for the FR-CONTENT-05
 * attribution line. Derived from the recorded `source_url` rather than stored:
 * SDD §4.2 fixes the columns of `words` and carries no source-name column, and
 * the host is exactly the identifying part of the entry URL.
 *
 * @param {string} sourceUrl
 * @returns {string}
 */
function sourceNameFor(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'the upstream dictionary';
  }
}

/**
 * @param {object} dependencies
 * @param {import('express').RequestHandler} dependencies.wordRequestRateLimit
 * @param {(token: string, remoteIp?: string) => Promise<{ success: boolean }>}
 *   dependencies.verifyTurnstile
 * @returns {import('express').Router}
 */
export function wordRouter({ wordRequestRateLimit, verifyTurnstile }) {
  const router = Router();

  /**
   * FR-WORD-05. Registered before the `/:variant` patterns so the fixed path
   * is never shadowed by a variant segment.
   */
  router.post('/request-word', wordRequestRateLimit, async (req, res, next) => {
    try {
      const input = parseWordRequest(req.body);
      const result = await submitWordRequest(input, {
        verifyTurnstile,
        anonymousId: req.ensureAnonymousId(),
        remoteIp: req.ip,
      });

      // POST-redirect-GET: a refresh after submitting must not resubmit, and
      // the acknowledgement has to survive with JavaScript disabled
      // (FR-WORD-08), so the outcome travels in the URL rather than in a
      // client-side state update.
      //
      // A word that turned out to be present already needs no acknowledgement
      // beyond landing on it, and sending it without a query string keeps the
      // cacheable shell on its canonical URL rather than minting a second edge
      // cache entry for the same content.
      const target = `/${encodeURIComponent(input.variantCode)}/${encodeURIComponent(result.slug)}`;
      res.redirect(
        303,
        result.alreadyInDictionary
          ? target
          : `${target}?requested=${result.created ? 'new' : 'upvoted'}`,
      );
    } catch (error) {
      next(error);
    }
  });

  /**
   * FR-WORD-01: `GET /en-us/` (trailing slash, no word) redirects to the home
   * page and never returns a random word. Only a REGISTERED, ACTIVE variant
   * redirects; anything else falls through to the terminal 404, so an arbitrary
   * single-segment path is not silently bounced to the landing page.
   */
  router.get('/:variant', async (req, res, next) => {
    try {
      await requireActiveVariant(req.params.variant);
      res.redirect(301, '/');
    } catch {
      next();
    }
  });

  /**
   * The word page itself: the B2 cacheable shell (FR-WORD-01/02/03, SDD §5.3).
   */
  router.get('/:variant/:word', async (req, res, next) => {
    try {
      // FR-WORD-01: the variant is validated against `language_variants` BEFORE
      // the word lookup runs, so an unsupported variant 404s rather than
      // falling back to `en-us`.
      const variant = await requireActiveVariant(req.params.variant);

      // FR-WORD-02: normalise, then 301 to the canonical URL rather than
      // rendering on a denormalised one. A slug carrying a character outside
      // the variant's allow-list — every control character included — throws a
      // 400 from the validator.
      const { slug, isCanonical } = normaliseWordSlug(req.params.word, variant.code);
      if (!isCanonical) {
        res.redirect(301, `/${variant.code}/${encodeURIComponent(slug)}`);
        return;
      }

      const page = await getWordPage(variant, slug);

      // B2: this response is identical for every viewer of the word, so it
      // takes the shared edge-cache posture — and with it the rules that follow
      // from being shared: no per-viewer `Set-Cookie` (amended FR-AUTH-01) and
      // no per-response CSP nonce (amended NFR-SEC-03). The view therefore
      // carries no inline script or style.
      markCacheableShell(res);

      res.render('word', {
        variant,
        word: page.word,
        pronunciations: page.pronunciations,
        primaryPronunciation: page.primaryPronunciation,
        sourceName: sourceNameFor(page.word.sourceUrl),
        title: pageTitle(page.word.displayHeadword, variant.displayName),
        metaDescription: metaDescription(page.word.meaning),
        canonicalUrl: `${config.baseUrl}/${variant.code}/${encodeURIComponent(slug)}`,
        // V4: audio is served by Nginx from the content-addressed store in
        // production, and by the dev static mount locally. The view composes
        // the URL rather than the service, so no layer below HTTP knows a URL
        // shape.
        audioPublicPrefix: config.audio.publicPrefix,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default wordRouter;
