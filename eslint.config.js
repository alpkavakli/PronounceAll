/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Lint configuration (SDD v1.1 §7.3, §7.4, §7.6, NFR-SEC-07, NFR-SEC-12).
 *
 * The architecture is a property the build checks, not a rule a reviewer must
 * remember. Three families of rule carry that weight:
 *
 *   - `import/no-restricted-paths` enforces the C4 dependency direction, so a
 *     repository importing a service, a route importing a repository, or a
 *     business service importing the database pool fails `npm run lint` and
 *     therefore fails the merge gate (§7.8).
 *   - `no-restricted-syntax` forbids interpolated or concatenated SQL, so the
 *     parameterisation rule of NFR-SEC-07 cannot be broken quietly.
 *   - `no-restricted-properties` forbids `Math.random` for any value, since the
 *     project has no non-security use for it (§7.6, NFR-SEC-12).
 */

import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import security from 'eslint-plugin-security';

/** Layer directories, relative to the config file. */
const SRC = './src';

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'docs/**',
      'src/views/**',
      // Offline Piper tooling (V1): a Python virtualenv and a voice model, not
      // project source. Its vendored JavaScript is not ours to lint.
      'tools/piper/**',
    ],
  },

  js.configs.recommended,
  security.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': { node: { extensions: ['.js'] } },
    },
    rules: {
      'no-console': 'error',
      'no-var': 'error',
      // `const { secret, ...rest } = obj` is the idiom for omitting a field;
      // the omitted binding is intentionally unused.
      'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],

      // NFR-SEC-12 / §7.6. `Math.random` has no legitimate use here.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random is prohibited (NFR-SEC-12). Use src/lib/ids.js, which is CSPRNG-backed.',
        },
      ],

      // NFR-SEC-07 / §7.4. All SQL is parameterised; no user-controlled value
      // is ever concatenated or interpolated into a statement.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(query|execute)$/] > TemplateLiteral[expressions.length>0]",
          message:
            'Interpolated SQL is prohibited (NFR-SEC-07). Use a parameterised statement with ? placeholders.',
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(query|execute)$/] > BinaryExpression[operator='+']",
          message:
            'Concatenated SQL is prohibited (NFR-SEC-07). Use a parameterised statement with ? placeholders.',
        },
      ],

      // §7.3. The dependency rule, enforced rather than merely documented.
      'import/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: `${SRC}/repositories`,
              from: [`${SRC}/routes`, `${SRC}/services`, `${SRC}/middleware`],
              message:
                'Repositories sit at the bottom of the dependency direction (C4): routes -> services -> repositories.',
            },
            {
              target: `${SRC}/services`,
              from: [`${SRC}/routes`, `${SRC}/middleware`],
              message:
                'Services must not depend on the HTTP layer (C4). Domain logic stays independent of Express.',
            },
            {
              target: `${SRC}/services`,
              from: `${SRC}/lib`,
              except: ['./logger.js', './ids.js', './http.js'],
              message:
                'A business service must not import a concrete infrastructure client from lib/ (C4, §7.3). Receive it as an argument or through the composition root.',
            },
            {
              target: `${SRC}/routes`,
              from: [`${SRC}/repositories`, `${SRC}/lib`],
              message:
                'Routes depend on services, never directly on repositories or infrastructure clients (C4).',
            },
          ],
        },
      ],

      // Noisy and low-signal on a codebase with no dynamic property access on
      // untrusted keys; the parameterisation and boundary rules above carry the
      // security weight here.
      'security/detect-object-injection': 'off',
    },
  },

  {
    // The composition root is the one module that knows every layer (§3.3).
    files: ['src/app.js', 'src/server.js'],
    rules: { 'import/no-restricted-paths': 'off' },
  },

  {
    files: ['tests/**/*.js', '*.config.js', 'scripts/**/*.js'],
    // Browser globals included for the bodies of Playwright `page.evaluate()`
    // callbacks, which are serialised and run in the page, not in Node.
    languageOptions: { globals: { ...globals.node, ...globals.jest, ...globals.browser } },
    rules: {
      'import/no-restricted-paths': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  {
    files: ['src/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: { 'no-console': 'error' },
  },
];
