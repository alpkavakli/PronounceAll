/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Privacy Policy and the KVKK notice, rendered from the reviewed Markdown
 * documents themselves (FR-CONSENT-05), so the page cannot drift from the text
 * under review. Read and rendered once, at boot.
 *
 * A document is laid out as a reviewer's header, a `---` rule, the published
 * text, and optionally another rule followed by review notes. Only the
 * published text is served. Registered accounts exist now, so the
 * "include once accounts exist" markers are dropped; the owner-fact markers
 * stay visible until the owner fills them in, and the page says it is a draft.
 */

import { readFileSync } from 'node:fs';

import { marked } from 'marked';

/** "Include once accounts launch" markers, English and Turkish. */
const ACCOUNTS_MARKERS = /\s?\[(?:ACCOUNTS|HESAPLAR)\]/g;

/**
 * @param {string} markdown the whole document
 * @returns {string} the published text, between the first rule and the next
 */
export function publishedText(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() === '---');
  if (first === -1) throw new Error('A legal document must separate its review header with a --- rule');
  const end = lines.findIndex((line, index) => index > first && line.trim() === '---');
  return lines
    .slice(first + 1, end === -1 ? lines.length : end)
    .join('\n')
    .replace(ACCOUNTS_MARKERS, '')
    .trim();
}

/**
 * @param {string} markdown
 * @returns {string} HTML for the published text
 */
export function renderLegalMarkdown(markdown) {
  return marked.parse(publishedText(markdown), { async: false, gfm: true });
}

/**
 * @param {string} path a Markdown file
 * @returns {{ html: string }}
 */
export function loadLegalDocument(path) {
  // The path is a constant of the composition root, never request input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return Object.freeze({ html: renderLegalMarkdown(readFileSync(path, 'utf8')) });
}
