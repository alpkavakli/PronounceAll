/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Licence-header check (NFR-LEGAL-03).
 *
 * Verifies that every `.js`, `.mjs`, `.cjs`, and `.ejs` file in the repository
 * carries the SPDX identifier and a reference to LICENSE-NOTICE.md. Run by
 * `npm run lint:licence` and gated in continuous integration (NFR-OPS-08).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { glob } from 'node:fs/promises';

const EXTENSIONS = ['js', 'mjs', 'cjs', 'ejs'];
const IGNORED = ['node_modules', '.git', 'coverage', 'playwright-report', 'test-results', 'docs'];

const REQUIRED_SPDX = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const REQUIRED_REFERENCE = 'LICENSE-NOTICE.md';

/** Only the head of a file is inspected; the header belongs at the top. */
const HEAD_BYTES = 512;

async function main() {
  const offenders = [];
  let inspected = 0;
  const pattern = `**/*.{${EXTENSIONS.join(',')}}`;

  for await (const entry of glob(pattern, { exclude: (name) => IGNORED.includes(name) })) {
    const relative = entry.split(path.sep).join('/');
    if (IGNORED.some((dir) => relative.startsWith(`${dir}/`) || relative.includes(`/${dir}/`))) {
      continue;
    }

    inspected += 1;
    const head = (await readFile(relative, 'utf8')).slice(0, HEAD_BYTES);
    if (!head.includes(REQUIRED_SPDX) || !head.includes(REQUIRED_REFERENCE)) {
      offenders.push(relative);
    }
  }

  if (offenders.length > 0) {
    process.stderr.write(
      `Missing licence header (NFR-LEGAL-03) in ${offenders.length} file(s):\n` +
        offenders.map((file) => `  ${file}\n`).join('') +
        `\nEvery source file must carry:\n  ${REQUIRED_SPDX}\n  See ${REQUIRED_REFERENCE} at the repository root.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (inspected === 0) {
    process.stderr.write('Licence check inspected no files — the glob is wrong, not the repository.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Licence headers present in all ${inspected} source files.\n`);
}

await main();
