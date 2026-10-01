/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The least-privilege principals against the real code, Iteration 7 slice 5
 * (SDD v1.1 §4.9 with its 2026-10-01 amendment; Threat Model F3; FR-SAVE-03,
 * B1, C6).
 *
 * The principals are provisioned on the local server by the real script, then:
 * the grants are probed directly; the real web server runs as `pa_app` through
 * the main flows over HTTP, where any missing grant would be a 500; and the
 * erasure and retention jobs run as `pa_erase` and `pa_maint` in child
 * processes. Needs an administrative MySQL login: TEST_MYSQL_ADMIN_USER /
 * TEST_MYSQL_ADMIN_PASSWORD (local default: compose's root / devroot).
 */

import { spawn } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import process from 'node:process';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import mysql from 'mysql2/promise';

const { config } = await import('../../src/config/index.js');
const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { closeRedis } = await import('../../src/lib/redis.js');
const { issueCsrfToken, issueCsrfTokenFor } = await import('../../src/services/csrf.service.js');
const { provisionPrincipals } = await import('../../scripts/provision-database-principals.js');

const PRINCIPALS = ['pa_app', 'pa_erase', 'pa_maint', 'pa_seed', 'pa_backup', 'pa_migrate'];
const PASSWORDS = Object.fromEntries(PRINCIPALS.map((name) => [name, `t-${randomBytes(18).toString('base64url')}`]));
const CSRF_SECRET = randomBytes(32).toString('base64url');
const ADMIN = { user: process.env.TEST_MYSQL_ADMIN_USER ?? 'root', password: process.env.TEST_MYSQL_ADMIN_PASSWORD ?? 'devroot' };

let admin;
const connectAs = (user) =>
  mysql.createConnection({ host: config.mysql.host, port: config.mysql.port, database: config.mysql.database, user, password: PASSWORDS[user] });

beforeAll(async () => {
  admin = await mysql.createConnection({ host: config.mysql.host, port: config.mysql.port, database: config.mysql.database, ...ADMIN });
  await provisionPrincipals(admin, PASSWORDS);
});

afterAll(async () => {
  for (const name of PRINCIPALS) await admin.query('DROP USER IF EXISTS ?@?', [name, '%']);
  await admin.end();
  await closePool();
  await closeRedis();
});

/** Expect a statement to be refused for lack of privilege. */
async function refused(connection, sql, params = []) {
  await expect(connection.query(sql, params)).rejects.toMatchObject({
    code: expect.stringMatching(/^ER_(TABLEACCESS_DENIED_ERROR|COLUMNACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR|SPECIFIC_ACCESS_DENIED_ERROR)$/),
  });
}

describe('§4.9 — what each principal may not do', () => {
  test('pa_app: history and bindings are append-only at the grant level; no deletes; no tombstones', async () => {
    const app = await connectAs('pa_app');
    try {
      await refused(app, 'UPDATE user_activity_events SET event_value = NULL WHERE event_id = 0');
      await refused(app, 'DELETE FROM user_activity_events WHERE event_id = 0');
      await refused(app, 'UPDATE identity_bindings SET user_id = 0 WHERE binding_id = 0');
      await refused(app, 'DELETE FROM identity_bindings WHERE binding_id = 0');
      await refused(app, 'DELETE FROM users WHERE user_id = 0');
      await refused(app, 'DELETE FROM auth_tokens WHERE token_id = 0');
      await refused(app, 'SELECT COUNT(*) FROM deletion_audit');
      await refused(app, 'INSERT INTO words (variant_id) VALUES (0)');
      await refused(app, 'CREATE TABLE should_not_exist (id INT)');
      expect((await app.query('SELECT COUNT(*) AS n FROM words'))[0][0].n).toBeGreaterThan(0);
    } finally {
      await app.end();
    }
  });

  test('pa_erase: deletes user data, but no catalogue, no wider UPDATE than its two claims', async () => {
    const erase = await connectAs('pa_erase');
    try {
      await refused(erase, 'SELECT COUNT(*) FROM words');
      await refused(erase, 'UPDATE users SET username = username WHERE user_id = 0');
      await refused(erase, 'UPDATE anonymous_profiles SET last_seen_at = NOW() WHERE anonymous_id = ?', ['x']);
      await refused(erase, 'UPDATE word_requests SET status = ? WHERE request_id = 0', ['open']);
      await refused(erase, 'INSERT INTO user_activity_events (target_kind) VALUES (?)', ['word']);
      await erase.query('UPDATE users SET deletion_state = deletion_state WHERE user_id = 0');
    } finally {
      await erase.end();
    }
  });

  test('pa_maint: auth_tokens only', async () => {
    const maint = await connectAs('pa_maint');
    try {
      await maint.query('DELETE FROM auth_tokens WHERE token_id = 0');
      await refused(maint, 'SELECT COUNT(*) FROM users');
      await refused(maint, 'DELETE FROM user_activity_events WHERE event_id = 0');
    } finally {
      await maint.end();
    }
  });

  test('pa_seed: catalogue, its two deletes and word-request status; nothing personal', async () => {
    const seed = await connectAs('pa_seed');
    try {
      await seed.query('DELETE FROM pronunciation_phonemes WHERE pronunciation_id = 0');
      await seed.query('DELETE FROM word_pronunciations WHERE pronunciation_id = 0');
      await refused(seed, 'DELETE FROM words WHERE word_id = 0');
      await refused(seed, 'SELECT COUNT(*) FROM users');
      await refused(seed, 'SELECT COUNT(*) FROM user_activity_events');
      await refused(seed, 'UPDATE word_requests SET submitted_by_user_id = NULL WHERE request_id = 0');
    } finally {
      await seed.end();
    }
  });

  test('pa_backup: reads everything, writes nothing', async () => {
    const backup = await connectAs('pa_backup');
    try {
      for (const table of ['users', 'deletion_audit', 'flyway_schema_history', 'current_identity_bindings']) {
        await backup.query('SELECT COUNT(*) FROM ??', [table]);
      }
      await refused(backup, 'UPDATE users SET username = username WHERE user_id = 0');
      await refused(backup, 'DELETE FROM auth_tokens WHERE token_id = 0');
      await refused(backup, 'INSERT INTO deletion_audit (deletion_id) VALUES (?)', ['x']);
    } finally {
      await backup.end();
    }
  });

  test('provisioning converges: a stray extra grant is revoked by a rerun', async () => {
    await admin.query('GRANT DELETE ON users TO ?@?', ['pa_app', '%']);
    await provisionPrincipals(admin, { pa_app: PASSWORDS.pa_app });
    const app = await connectAs('pa_app');
    try {
      await refused(app, 'DELETE FROM users WHERE user_id = 0');
    } finally {
      await app.end();
    }
  });
});

// ---------------------------------------------------------------------------
// The real code under the real principals
// ---------------------------------------------------------------------------

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

function childEnvironment(principal, extra = {}) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    MYSQL_USER: principal,
    MYSQL_PASSWORD: PASSWORDS[principal],
    CSRF_SECRET,
    RATE_LIMIT_STORE: 'memory',
    LOG_LEVEL: 'error',
    ...extra,
  };
}

/** Run a module snippet in a child process as `principal`; resolves with its stdout. */
function runAs(principal, code) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: childEnvironment(principal), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (status) => (status === 0 ? resolve(out.trim()) : reject(new Error(`exit ${status}: ${err.slice(-1500)}`))));
  });
}

describe('§4.9 — the web process runs as pa_app', () => {
  let server;
  let base;
  const errors = [];

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['src/server.js'], {
      env: childEnvironment('pa_app', { PORT: String(port), APP_BASE_URL: base, LOG_LEVEL: 'warn' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) if (line.includes('"level":50') || line.includes('"level":60')) errors.push(line.slice(0, 600));
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('The pa_app server did not start');
  }, 30_000);

  afterAll(() => {
    server?.kill();
  });

  function request(path, { method = 'GET', cookies = {}, form, json, csrf } = {}) {
    const headers = { Origin: base, Cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ') };
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ ...form, ...(csrf ? { _csrf: csrf } : {}) }).toString();
    } else if (json) {
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = csrf;
      body = JSON.stringify(json);
    }
    return fetch(`${base}${path}`, { method, headers, body, redirect: 'manual' });
  }
  const sidOf = (response) => response.headers.getSetCookie().find((line) => line.startsWith('pa_sid='))?.split(';')[0].slice('pa_sid='.length);

  test('browse, save, register (LINK and recompute), practice, consent, delete and restore, then hard delete — no 500, no logged error', async () => {
    const anonymousId = generateAnonymousId();
    const [[{ wordId }]] = await getPool().query("SELECT word_id AS wordId FROM words WHERE normalized_headword = 'cupcake'");
    const anon = { pa_uid: anonymousId };
    const anonCsrf = issueCsrfToken(CSRF_SECRET, anonymousId);

    for (const path of ['/', '/en-us/cupcake', '/en-us/learnIPA', '/learnIPA', '/privacy', '/sitemap.xml', '/settings', '/practice']) {
      expect([path, (await request(path, { cookies: anon })).status]).toEqual([path, 200]);
    }
    expect((await request(`/viewer-state?variant=en-us&words=${wordId}`, { cookies: anon })).status).toBe(200);
    const saved = await request('/save', {
      method: 'POST',
      cookies: anon,
      csrf: anonCsrf,
      json: { action: 'save', targetKind: 'word', targetId: wordId, idempotencyKey: randomUUID().replaceAll('-', '') },
    });
    expect(saved.status).toBeLessThan(300);

    const username = `zzp${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const password = `zq-${randomUUID()}`;
    const registered = await request('/register', {
      method: 'POST',
      cookies: anon,
      csrf: anonCsrf,
      form: { username, password, acknowledgeNoRecovery: 'yes', 'cf-turnstile-response': 'test' },
    });
    expect(registered.status).toBe(303);
    const sessionId = sidOf(registered);
    expect(sessionId).toBeTruthy();
    const signedIn = { pa_uid: generateAnonymousId(), pa_sid: sessionId };
    const sessionCsrf = () => issueCsrfTokenFor(CSRF_SECRET, { sessionId: signedIn.pa_sid });

    expect((await request('/practice', { cookies: signedIn })).status).toBe(200);
    expect((await request('/settings/cookies', { method: 'POST', cookies: signedIn, csrf: sessionCsrf(), form: { ads: 'on' } })).status).toBe(303);

    // Soft delete, then sign in to restore.
    const reauth = await (await request('/settings/delete/reauth', { method: 'POST', cookies: signedIn, csrf: sessionCsrf(), form: { password } })).text();
    const nonce = reauth.match(/name="reauth" value="([A-Za-z0-9_-]{43})"/)?.[1];
    expect(nonce).toBeTruthy();
    expect((await request('/settings/delete', { method: 'POST', cookies: signedIn, csrf: sessionCsrf(), form: { reauth: nonce, option: 'soft' } })).status).toBe(200);
    const loginId = generateAnonymousId();
    const restored = await request('/login', {
      method: 'POST',
      cookies: { pa_uid: loginId },
      csrf: issueCsrfToken(CSRF_SECRET, loginId),
      form: { identifier: username, password, 'cf-turnstile-response': 'test' },
    });
    expect(restored.headers.get('location')).toBe('/login?restored=1');
    signedIn.pa_sid = sidOf(restored);

    // Hard delete, for the erasure test below.
    const again = await (await request('/settings/delete/reauth', { method: 'POST', cookies: signedIn, csrf: sessionCsrf(), form: { password } })).text();
    const hardNonce = again.match(/name="reauth" value="([A-Za-z0-9_-]{43})"/)?.[1];
    expect((await request('/settings/delete', { method: 'POST', cookies: signedIn, csrf: sessionCsrf(), form: { reauth: hardNonce, option: 'hard' } })).status).toBe(200);

    expect(errors).toEqual([]);

    // The erasure worker's purge, as pa_erase: the account and its bound identity go.
    const [[{ userId }]] = await getPool().query('SELECT user_id AS userId FROM users WHERE username_lower = ?', [username]);
    const purged = await runAs(
      'pa_erase',
      `import { buildPurge } from ${JSON.stringify(new URL('../../tests/integration/support/principal-jobs.js', import.meta.url).href)};
       const erased = await buildPurge(); process.stdout.write(String(erased)); process.exit(0);`,
    );
    expect(Number(purged)).toBeGreaterThanOrEqual(1);
    expect((await getPool().query('SELECT COUNT(*) AS n FROM users WHERE user_id = ?', [userId]))[0][0].n).toBe(0);
    expect((await getPool().query('SELECT COUNT(*) AS n FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]))[0][0].n).toBe(0);
  }, 90_000);
});

describe('§4.9 — the other jobs run as their principals', () => {
  test('the dormancy prune runs as pa_erase', async () => {
    const anonymousId = generateAnonymousId();
    await getPool().execute('INSERT INTO anonymous_profiles (anonymous_id, created_at, last_seen_at) VALUES (?, ?, ?)', [
      anonymousId,
      new Date('2020-01-01T00:00:00Z'),
      new Date('2020-01-01T00:00:00Z'),
    ]);
    const pruned = await runAs(
      'pa_erase',
      `import { buildDormancyPrune } from ${JSON.stringify(new URL('./support/principal-jobs.js', import.meta.url).href)};
       process.stdout.write(String(await buildDormancyPrune())); process.exit(0);`,
    );
    expect(Number(pruned)).toBeGreaterThanOrEqual(1);
    expect((await getPool().query('SELECT COUNT(*) AS n FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]))[0][0].n).toBe(0);
  }, 30_000);

  test('the token prune runs as pa_maint', async () => {
    const [[{ userId }]] = await getPool().query('SELECT user_id AS userId FROM users ORDER BY user_id LIMIT 1');
    await getPool().execute(
      "INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at, created_at) VALUES (?, 'password_reset', ?, ?, NOW(3))",
      [userId, randomBytes(32).toString('hex'), new Date(Date.now() - randomInt(60_000, 120_000))],
    );
    const deleted = await runAs(
      'pa_maint',
      `import { buildTokenPrune } from ${JSON.stringify(new URL('./support/principal-jobs.js', import.meta.url).href)};
       process.stdout.write(String(await buildTokenPrune())); process.exit(0);`,
    );
    expect(Number(deleted)).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
