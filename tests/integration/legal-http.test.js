/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The legal pages, the cookie notice and the crawler files, Iteration 7 slice 1
 * (FR-CONSENT-01, FR-CONSENT-05, FR-WORD-09). Maintainer decision 2026-10-01:
 * until the owner approves the text, the pages serve the drafts with a notice.
 */

import { afterAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

const { createApp } = await import('../../src/app.js');
const { config } = await import('../../src/config/index.js');
const { publishedText, renderLegalMarkdown } = await import('../../src/lib/legal-documents.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { closeRedis } = await import('../../src/lib/redis.js');

const app = createApp({ isBreachedPassword: async () => false, sendMail: async () => {}, googleOidc: null });

afterAll(async () => {
  await closePool();
  await closeRedis();
});

describe('FR-CONSENT-05 — /privacy and /kvkk', () => {
  test('both answer 200 without a session, with no cookie but pa_uid', async () => {
    for (const path of ['/privacy', '/kvkk']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      const cookies = [response.headers['set-cookie'] ?? []].flat().map((line) => line.split('=')[0]);
      expect(cookies.every((name) => name === 'pa_uid')).toBe(true);
    }
  });

  test('the English policy covers what the requirement lists, and says it is a draft', async () => {
    const { text } = await request(app).get('/privacy');
    expect(text).toContain('<html lang="en">');
    expect(text).toContain('not yet in force');
    for (const heading of ['What we collect, and why', 'Legal bases', 'How long we keep it', 'Who receives data', 'Your rights', 'Cookies']) {
      expect(text).toContain(heading);
    }
    expect(text).toContain(`<link rel="canonical" href="${config.baseUrl}/privacy">`);
  });

  test('the Turkish notice is served in Turkish, with the KVKK md. 11 rights', async () => {
    const { text } = await request(app).get('/kvkk');
    expect(text).toContain('<html lang="tr">');
    expect(text).toContain('henüz yürürlükte değildir');
    expect(text).toContain('Veri sorumlusu');
    expect(text).toContain('KVKK md. 11');
  });

  test('only the published text is served: no reviewer header, no review notes, no accounts markers', async () => {
    for (const path of ['/privacy', '/kvkk']) {
      const { text } = await request(app).get(path);
      expect(text).not.toContain('Source of truth');
      expect(text).not.toContain('Review notes');
      expect(text).not.toContain('[ACCOUNTS]');
      expect(text).not.toContain('[HESAPLAR]');
    }
  });

  test('every page links to both, and carries the cookie notice with the Privacy Policy link', async () => {
    for (const path of ['/', '/settings', '/learnIPA', '/privacy']) {
      const { text } = await request(app).get(path);
      expect(text).toContain('href="/privacy"');
      expect(text).toContain('href="/kvkk"');
      expect(text).toContain('aria-label="Cookie notice"');
      expect(text).toContain('/js/cookie-notice.js');
    }
  });
});

describe('the published-text extraction', () => {
  test('keeps the text between the first rule and the next, and drops accounts markers', () => {
    const doc = '# Title\n\nReviewer notes\n\n---\n\n## 1. Body [ACCOUNTS]\n\nKept.\n\n---\n\n## Review notes\n';
    expect(publishedText(doc)).toBe('## 1. Body\n\nKept.');
    expect(publishedText('# T\r\n---\r\nAll the rest [HESAPLAR] here')).toBe('All the rest here');
    expect(() => publishedText('# No rule at all')).toThrow();
  });

  test('renders GitHub tables', () => {
    expect(renderLegalMarkdown('h\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n')).toContain('<table>');
  });
});

describe('FR-WORD-09 — the crawler files and descriptions', () => {
  test('robots.txt names the sitemap and blocks no page', async () => {
    const response = await request(app).get('/robots.txt');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain(`Sitemap: ${config.baseUrl}/sitemap.xml`);
    for (const page of ['/login', '/register', '/settings', '/practice', '/privacy', '/kvkk', '/learnIPA']) {
      expect(response.text.split('\n')).not.toContain(`Disallow: ${page}`);
    }
  });

  test('the sitemap lists every word page at its canonical URL, and the content pages', async () => {
    const response = await request(app).get('/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    const locs = [...response.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    for (const path of ['/', '/learnIPA', '/en-us/learnIPA', '/privacy', '/kvkk', '/en-us/cupcake']) {
      expect(locs).toContain(`${config.baseUrl}${path}`);
    }
    const [[{ words }]] = await getPool().query(
      "SELECT COUNT(*) AS words FROM words w JOIN language_variants v ON v.variant_id = w.variant_id WHERE v.is_active = 1",
    );
    expect(locs.length).toBe(Number(words) + 5);
    const accountPages = ['/login', '/register', '/settings', '/practice'].map((path) => `${config.baseUrl}${path}`);
    expect(locs.filter((loc) => accountPages.includes(loc))).toEqual([]);
  });

  test('sampled sitemap word URLs are canonical: 200, not a redirect; XML escaping round-trips', async () => {
    const { text } = await request(app).get('/sitemap.xml');
    const unescapeXml = (value) =>
      value.replace(/&(lt|gt|amp|apos|quot);/g, (_entity, name) => ({ lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' })[name]);
    const words = [...text.matchAll(/<loc>[^<]+(\/en-us\/[^<]+)<\/loc>/g)]
      .map((match) => unescapeXml(match[1]))
      .filter((path) => !path.endsWith('/learnIPA'));
    // The first headword in order is `'em`, which exercises the escaping.
    for (const path of [words[0], words[Math.floor(words.length / 2)], words.at(-1)]) {
      expect((await request(app).get(path)).status).toBe(200);
    }
  });

  test('every page carries a meta description', async () => {
    for (const path of ['/', '/login', '/register', '/settings', '/practice', '/learnIPA', '/en-us/learnIPA', '/kvkk']) {
      expect((await request(app).get(path)).text).toMatch(/<meta name="description" content="[^"]{20,}">/);
    }
  });
});
