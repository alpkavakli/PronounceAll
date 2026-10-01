/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The legal pages and the crawler files (FR-CONSENT-05, FR-WORD-09).
 *
 *   GET /privacy      the Privacy Policy, in English
 *   GET /kvkk         the KVKK Aydınlatma Metni, in Turkish
 *   GET /robots.txt   crawl rules and the sitemap's address
 *   GET /sitemap.xml  every public content page, word pages included
 *
 * The legal pages are public, need no session, and set no conditional cookie.
 * Until the owner approves the text (maintainer decision 2026-10-01) they serve
 * the current drafts with a visible notice that the text is not yet in force.
 * DYNAMIC, like every legal page (SDD v1.1 §6.3).
 */

import { Router } from 'express';

import { config } from '../config/index.js';
import { listSitemapPaths } from '../services/catalogue.service.js';

/**
 * Endpoints that are not pages. Every page stays crawlable: Lighthouse's SEO
 * audit counts a robots.txt Disallow as "blocked from indexing" (NFR-PERF-03).
 */
const NOT_PAGES = Object.freeze([
  '/auth/',
  '/viewer-state',
  '/search',
  '/verify-email',
  '/reset-password/confirm',
  '/settings/email/confirm',
]);

const escapeXml = (value) =>
  value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]);

/**
 * @param {object} dependencies
 * @param {{ privacy: { html: string }, kvkk: { html: string } }} dependencies.documents
 * @returns {import('express').Router}
 */
export function legalRouter({ documents }) {
  const router = Router();

  router.get('/privacy', (req, res) => {
    res.render('legal', {
      lang: 'en',
      title: 'Privacy Policy',
      heading: 'Privacy Policy',
      metaDescription: 'What PronounceAll collects, why, how long it keeps it, who receives it, and your rights.',
      canonicalUrl: `${config.baseUrl}/privacy`,
      draftNotice: 'Draft: this policy is awaiting review and is not yet in force. Bracketed items are still to be filled in.',
      html: documents.privacy.html,
    });
  });

  router.get('/kvkk', (req, res) => {
    res.render('legal', {
      lang: 'tr',
      title: 'KVKK Aydınlatma Metni',
      heading: 'KVKK Aydınlatma Metni',
      metaDescription: 'PronounceAll kişisel verilerin işlenmesine ilişkin 6698 sayılı KVKK kapsamındaki aydınlatma metni.',
      canonicalUrl: `${config.baseUrl}/kvkk`,
      draftNotice: 'Taslak: bu metin incelemededir ve henüz yürürlükte değildir. Köşeli parantez içindeki bilgiler henüz doldurulmamıştır.',
      html: documents.kvkk.html,
    });
  });

  router.get('/robots.txt', (req, res) => {
    const lines = ['User-agent: *', ...NOT_PAGES.map((path) => `Disallow: ${path}`), '', `Sitemap: ${config.baseUrl}/sitemap.xml`, ''];
    res.type('text/plain').send(lines.join('\n'));
  });

  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const urls = (await listSitemapPaths()).map((path) => `  <url><loc>${escapeXml(`${config.baseUrl}${path}`)}</loc></url>`);
      res
        .type('application/xml')
        .send(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
        );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
