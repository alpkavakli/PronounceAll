/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Changing a password and an email from Settings, Iteration 6 slice 2
 * (FR-SET-02, FR-AUTH-06/07/11/12; V3). Maintainer decision 2026-09-30: a
 * pending email is held in pending columns until its link is followed.
 */

import { createHash } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';

process.env.RATE_LIMIT_STORE = 'memory';

const { createApp } = await import('../../src/app.js');
const { config } = await import('../../src/config/index.js');
const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { hashPassword } = await import('../../src/lib/passwords.js');
const { closeRedis } = await import('../../src/lib/redis.js');
const { createSessionStore } = await import('../../src/lib/session-store.js');
const { issueCsrfToken, issueCsrfTokenFor } = await import('../../src/services/csrf.service.js');
const { createSessionService } = await import('../../src/services/session.service.js');

const ORIGIN = new URL(config.baseUrl).origin;
const PASSWORD = 'zq-the-original-passphrase';
const NEW_PASSWORD = 'zq-the-replacement-passphrase';

let outbox = [];
const newApp = () =>
  createApp({
    isBreachedPassword: async (password) => password === 'password123-breached',
    sendMail: async (message) => void outbox.push(message),
    googleOidc: null,
  });
const sessions = createSessionService({ store: createSessionStore() });
const userIds = [];

beforeEach(() => {
  outbox = [];
});

/** A password account, optionally with a verified email, and a session for it. */
async function account({ email = null, provider = 'password' } = {}) {
  const now = new Date();
  const name = `zzc${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`;
  const [result] = await getPool().execute(
    'INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [name, name, now, now],
  );
  const userId = Number(result.insertId);
  userIds.push(userId);
  if (provider === 'password') {
    await getPool().execute(
      `INSERT INTO user_accounts (user_id, provider, email, email_lower, email_verified_at, password_hash, created_at, updated_at)
            VALUES (?, 'password', ?, ?, ?, ?, ?, ?)`,
      [userId, email, email?.toLowerCase() ?? null, email ? now : null, await hashPassword(PASSWORD), now, now],
    );
  } else {
    await getPool().execute(
      `INSERT INTO user_accounts (user_id, provider, email, email_lower, email_verified_at, google_sub, created_at, updated_at)
            VALUES (?, 'google', ?, ?, ?, ?, ?, ?)`,
      [userId, email, email?.toLowerCase() ?? null, now, `sub-${userId}`, now, now],
    );
  }
  return { userId, username: name, sessionId: await sessions.startSession(userId, 0) };
}

function post(app, path, sessionId, fields, { csrf } = {}) {
  const anonymousId = generateAnonymousId();
  const token = csrf !== undefined ? csrf : sessionId ? issueCsrfTokenFor(config.csrf.secret, { sessionId }) : issueCsrfToken(config.csrf.secret, anonymousId);
  const body = new URLSearchParams({ ...fields, ...(token ? { _csrf: token } : {}) });
  return request(app)
    .post(path)
    .set('Cookie', [`pa_uid=${anonymousId}`, ...(sessionId ? [`pa_sid=${sessionId}`] : [])])
    .set('Origin', ORIGIN)
    .type('form')
    .send(body.toString());
}

const signedIn = async (app, sessionId) =>
  (await request(app).get('/settings').set('Cookie', [`pa_uid=${generateAnonymousId()}`, `pa_sid=${sessionId}`])).text.includes('Signed in as');
const accountRow = async (userId) =>
  (await getPool().execute('SELECT u.session_epoch, a.* FROM users u JOIN user_accounts a ON a.user_id = u.user_id WHERE u.user_id = ?', [userId]))[0][0];
const sidOf = (response) =>
  [response.headers['set-cookie'] ?? []].flat().find((line) => line.startsWith('pa_sid='))?.split(';')[0].split('=')[1];
const linkTokenTo = (address) => {
  const message = outbox.filter((entry) => entry.to === address).at(-1);
  const marker = '/settings/email/confirm?token=';
  const at = message?.text.indexOf(marker) ?? -1;
  return at === -1 ? null : message.text.slice(at + marker.length).match(/^[A-Za-z0-9_-]+/)[0];
};
const newAddress = () => `zzc-${generateAnonymousId().slice(0, 13)}@example.test`;

afterAll(async () => {
  const pool = getPool();
  for (const id of userIds) {
    await pool.execute('DELETE FROM auth_tokens WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM consent_records WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM user_accounts WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE user_id = ?', [id]);
    await createSessionStore().destroyAllForUser(id);
  }
  await closePool();
  await closeRedis();
});

describe('FR-SET-02 — change password', () => {
  test('a wrong current password is refused generically and changes nothing', async () => {
    const app = newApp();
    const { userId, sessionId } = await account();
    const before = await accountRow(userId);

    const response = await post(app, '/settings/password', sessionId, { currentPassword: 'not it', newPassword: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect(response.text).toContain('That is not your current password.');
    expect(await accountRow(userId)).toEqual(before);
    expect(await signedIn(app, sessionId)).toBe(true);
  });

  test('success: new hash, every other session ended, this device on a new session, reset links closed', async () => {
    const app = newApp();
    const { userId, sessionId } = await account({ email: newAddress() });
    const otherDevice = await sessions.startSession(userId, 0);
    await getPool().execute(
      "INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at, created_at) VALUES (?, 'password_reset', ?, NOW(3) + INTERVAL 1 HOUR, NOW(3))",
      [userId, createHash('sha256').update(generateAnonymousId()).digest('hex')],
    );
    const before = await accountRow(userId);

    const response = await post(app, '/settings/password', sessionId, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/settings?saved=password');

    const after = await accountRow(userId);
    expect(after.session_epoch).toBe(before.session_epoch + 1);
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(after.password_hash).toMatch(/^\$2b\$12\$/);

    const fresh = sidOf(response);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(sessionId);
    expect(await signedIn(app, fresh)).toBe(true);
    expect(await signedIn(app, sessionId)).toBe(false);
    expect(await signedIn(app, otherDevice)).toBe(false);

    const [open] = await getPool().execute(
      "SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND token_type = 'password_reset' AND consumed_at IS NULL",
      [userId],
    );
    expect(Number(open[0].n)).toBe(0);
  });

  test('the new password follows FR-AUTH-07: too short or breached is refused', async () => {
    const app = newApp();
    const { userId, sessionId } = await account();
    const before = await accountRow(userId);
    expect((await post(app, '/settings/password', sessionId, { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    const breached = await post(app, '/settings/password', sessionId, { currentPassword: PASSWORD, newPassword: 'password123-breached' });
    expect(breached.status).toBe(400);
    expect(breached.text).toContain('known breach');
    expect((await accountRow(userId)).password_hash).toBe(before.password_hash);
  });

  test('signed out goes to sign in; without CSRF it is refused', async () => {
    const app = newApp();
    const signedOut = await post(app, '/settings/password', null, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.location).toBe('/login');

    const { sessionId } = await account();
    expect((await post(app, '/settings/password', sessionId, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { csrf: '' })).status).toBe(403);
  });

  test('the current-password check is rate limited like sign-in', async () => {
    const app = newApp();
    const { sessionId } = await account();
    const anonymousId = generateAnonymousId();
    const attempt = () =>
      request(app)
        .post('/settings/password')
        .set('Cookie', [`pa_uid=${anonymousId}`, `pa_sid=${sessionId}`])
        .set('Origin', ORIGIN)
        .type('form')
        .send(
          new URLSearchParams({
            currentPassword: 'guess',
            newPassword: NEW_PASSWORD,
            _csrf: issueCsrfTokenFor(config.csrf.secret, { sessionId }),
          }).toString(),
        );
    for (let index = 0; index < 5; index += 1) expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(429);
  });
});

describe('FR-SET-02 — change email', () => {
  test('a link goes to the new address; the old one stays active until it is followed', async () => {
    const app = newApp();
    const oldAddress = newAddress();
    const target = newAddress();
    const { userId, sessionId } = await account({ email: oldAddress });

    const response = await post(app, '/settings/email', sessionId, { email: target, currentPassword: PASSWORD });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/settings?saved=email-sent');
    expect(outbox.map((message) => message.to)).toEqual([target]);

    let row = await accountRow(userId);
    expect(row.email).toBe(oldAddress);
    expect(row.pending_email).toBe(target);

    const confirm = await request(app).get(`/settings/email/confirm?token=${linkTokenTo(target)}`);
    expect(confirm.status).toBe(303);
    expect(confirm.headers.location).toBe('/settings?saved=email-changed');
    expect([confirm.headers['set-cookie'] ?? []].flat().some((line) => line.startsWith('pa_sid='))).toBe(false);

    row = await accountRow(userId);
    expect(row).toMatchObject({ email: target, email_lower: target.toLowerCase(), pending_email: null, pending_email_lower: null });
    expect(row.email_verified_at).not.toBeNull();
  });

  test('a link works once, and a newer request replaces an older one', async () => {
    const app = newApp();
    const { userId, sessionId } = await account({ email: newAddress() });
    const first = newAddress();
    const second = newAddress();
    await post(app, '/settings/email', sessionId, { email: first, currentPassword: PASSWORD });
    const firstToken = linkTokenTo(first);
    await post(app, '/settings/email', sessionId, { email: second, currentPassword: PASSWORD });

    expect((await request(app).get(`/settings/email/confirm?token=${firstToken}`)).status).toBe(400);
    const secondToken = linkTokenTo(second);
    expect((await request(app).get(`/settings/email/confirm?token=${secondToken}`)).status).toBe(303);
    expect((await request(app).get(`/settings/email/confirm?token=${secondToken}`)).status).toBe(400);
    expect((await accountRow(userId)).email).toBe(second);
  });

  test('a wrong password, an address in use or a malformed one: one generic refusal, nothing sent', async () => {
    const app = newApp();
    const taken = newAddress();
    await account({ email: taken });
    const { userId, sessionId } = await account({ email: newAddress() });

    expect((await post(app, '/settings/email', sessionId, { email: newAddress(), currentPassword: 'wrong' })).status).toBe(400);
    for (const email of [taken.toUpperCase(), 'not-an-address']) {
      const response = await post(app, '/settings/email', sessionId, { email, currentPassword: PASSWORD });
      expect(response.status).toBe(400);
      expect(response.text).toContain('This email cannot be used.');
    }
    expect(outbox).toEqual([]);
    expect((await accountRow(userId)).pending_email).toBeNull();
  });

  test('a pending address is reserved: another account cannot claim it, nor register with it (FR-AUTH-06)', async () => {
    const app = newApp();
    const contested = newAddress();
    const first = await account({ email: newAddress() });
    const second = await account({ email: newAddress() });
    await post(app, '/settings/email', first.sessionId, { email: contested, currentPassword: PASSWORD });

    expect((await post(app, '/settings/email', second.sessionId, { email: contested, currentPassword: PASSWORD })).status).toBe(400);
    const registration = await post(newApp(), '/register', null, {
      username: `zzc${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`,
      email: contested,
      password: 'zq-a-registrant-passphrase',
      'cf-turnstile-response': 'a-token',
    });
    expect(registration.status).toBe(400);
    expect(registration.text).toContain('This email cannot be used for registration.');
  });

  test('if another account took the address before confirmation, the link fails and the pending change is dropped', async () => {
    const app = newApp();
    const contested = newAddress();
    const { userId, sessionId } = await account({ email: newAddress() });
    await post(app, '/settings/email', sessionId, { email: contested, currentPassword: PASSWORD });
    const token = linkTokenTo(contested);
    // Simulate the race: another account's email becomes the contested one.
    const other = await account({ email: newAddress() });
    await getPool().execute('UPDATE user_accounts SET email = ?, email_lower = ? WHERE user_id = ?', [contested, contested.toLowerCase(), other.userId]);

    expect((await request(app).get(`/settings/email/confirm?token=${token}`)).status).toBe(400);
    const row = await accountRow(userId);
    expect(row.pending_email).toBeNull();
    expect(row.email).not.toBe(contested);
  });

  test('a username-only account can add its first email', async () => {
    const app = newApp();
    const { userId, sessionId } = await account();
    const added = newAddress();
    await post(app, '/settings/email', sessionId, { email: added, currentPassword: PASSWORD });
    await request(app).get(`/settings/email/confirm?token=${linkTokenTo(added)}`);
    expect((await accountRow(userId)).email).toBe(added);
  });
});

describe('Google accounts', () => {
  test('have no password or email forms, and the endpoints refuse', async () => {
    const app = newApp();
    const { sessionId } = await account({ email: newAddress(), provider: 'google' });
    const page = await request(app).get('/settings').set('Cookie', [`pa_uid=${generateAnonymousId()}`, `pa_sid=${sessionId}`]);
    expect(page.text).toContain('Your password and email are managed by Google.');
    expect(page.text).not.toContain('action="/settings/password"');

    const refused = await post(app, '/settings/password', sessionId, { currentPassword: 'x', newPassword: NEW_PASSWORD });
    expect(refused.status).toBe(403);
  });
});
