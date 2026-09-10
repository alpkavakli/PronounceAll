/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Capture the rendered word page so `size-limit` can weigh it (NFR-PERF-07).
 *
 * NFR-PERF-07 budgets a word page's initial DOCUMENT plus its critical CSS and
 * core JavaScript at 150 KB gzipped. The stylesheet and the script are files
 * `size-limit` can measure directly; the document is not — it is server-rendered
 * from the database, so it has to be produced before it can be weighed.
 *
 * This boots the application on an ephemeral port, fetches one seeded word page,
 * and writes the response body to `dist/`. It measures the real rendered page
 * rather than a template, which is the only version of the document a reader
 * actually downloads.
 *
 * Usage:
 *   node scripts/capture-word-page.js [--word cupcake] [--variant en-us]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { closePool } from '../src/lib/mysql.js';
import { closeRedis } from '../src/lib/redis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

async function main() {
  const args = process.argv.slice(2);
  const word = args.includes('--word') ? args[args.indexOf('--word') + 1] : 'cupcake';
  const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'en-us';

  const app = createApp();
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/${variant}/${encodeURIComponent(word)}`;
    const response = await fetch(url);

    if (response.status !== 200) {
      throw new Error(
        `Expected 200 for ${variant}/${word}, got ${response.status}. ` +
          'Has the seed run against this database? (npm run seed)',
      );
    }

    const html = await response.text();
    const outDir = path.join(repoRoot, 'dist');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'word-page.html');
    await fs.writeFile(outPath, html, 'utf8');

    process.stdout.write(
      `Captured ${variant}/${word} (${Buffer.byteLength(html)} bytes) to ${outPath}\n`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closePool();
    await closeRedis();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
