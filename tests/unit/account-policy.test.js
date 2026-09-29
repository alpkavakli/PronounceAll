/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The account policies that need no database: usernames (FR-AUTH-05, Appendix
 * A, V8), the breached-password check's k-anonymity (FR-AUTH-07), and password
 * hashing (FR-AUTH-08).
 */

import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';

import { createHibpChecker, splitPasswordHash } from '../../src/lib/hibp.js';
import { hashPassword, verifyPassword } from '../../src/lib/passwords.js';
import { usernameProblem } from '../../src/services/username-policy.service.js';

describe('FR-AUTH-05 — usernames', () => {
  test.each(['Alp', 'alp_k', 'a-b-c', 'Zz9', 'abcdefghijklmnopqrst'])('%s is acceptable', (name) => {
    expect(usernameProblem(name)).toBeNull();
  });

  test.each([
    ['ab', 'too short'],
    ['a_really_long_username_01', 'too long'],
    ['1abc', 'starts with a digit'],
    ['_abc', 'starts with an underscore'],
    ['ab c', 'contains a space'],
    ['abç', 'outside the charset'],
    ['', 'empty'],
  ])('%s is refused (%s)', (name) => {
    expect(usernameProblem(name)).not.toBeNull();
  });

  test.each(['root', 'ROOT', 'Admin', 'login', 'learnIPA', 'pronounceall', 'en-us', 'fr-fr', 'de-at'])(
    '%s is reserved',
    (name) => {
      expect(usernameProblem(name)).toBe('That username is not available.');
    },
  );

  test('profanity is refused, including obfuscated forms (V8)', () => {
    expect(usernameProblem('fuckface')).toBe('That username is not available.');
    expect(usernameProblem('fuuuck')).toBe('That username is not available.');
  });

  test('innocent names containing a rude substring are not refused', () => {
    expect(usernameProblem('Cassandra')).toBeNull();
    expect(usernameProblem('Scunthorpe')).toBeNull();
  });
});

describe('FR-AUTH-07 — breached-password check', () => {
  test('only the first five hex characters of the SHA-1 leave the server', async () => {
    const password = 'correct horse battery staple';
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const requested = [];
    const fetchImpl = async (url, options) => {
      requested.push({ url, options });
      return { ok: true, text: async () => 'ABCDEF0123456789ABCDEF0123456789ABC:3\r\n' };
    };

    await createHibpChecker({ fetchImpl })(password);

    expect(requested).toHaveLength(1);
    expect(requested[0].url).toBe(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);
    const sent = JSON.stringify(requested[0]);
    expect(sent).not.toContain(digest.slice(5));
    expect(sent).not.toContain(password);
  });

  test('a matching suffix with a count of 1 or more is breached; padding entries are not', async () => {
    const { suffix } = splitPasswordHash('password');
    const answer = (count) => async () => ({ ok: true, text: async () => `${suffix}:${count}\r\nOTHER:9` });

    expect(await createHibpChecker({ fetchImpl: answer(1) })('password')).toBe(true);
    expect(await createHibpChecker({ fetchImpl: answer(0) })('password')).toBe(false);
  });

  test('a hanging API is abandoned at the bounded timeout', async () => {
    const hanging = (url, { signal }) =>
      new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const started = Date.now();
    await expect(createHibpChecker({ fetchImpl: hanging, timeoutMs: 100 })('anything')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('an API error throws rather than passing the password', async () => {
    const failing = async () => ({ ok: false, status: 503, text: async () => '' });
    await expect(createHibpChecker({ fetchImpl: failing })('anything')).rejects.toThrow();
  });
});

describe('FR-AUTH-08 — password hashing', () => {
  test('bcrypt, cost 12, $2b$', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(hash).toHaveLength(60);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong horse battery staple', hash)).toBe(false);
  });

  test('with no stored hash, verification still runs and fails', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', undefined)).toBe(false);
  });
});
