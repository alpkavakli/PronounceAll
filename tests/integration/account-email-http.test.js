/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Accounts, Iteration 4 slice 2: email registration, verification, resend and
 * password reset (FR-AUTH-04/06/09/10/11/13/14/15, NFR-SEC-10, NFR-SEC-12;
 * SDD v1.1 §4.3, §5.6, V3).
 *
 * The invariants: only a token's hash is stored; every link works once and
 * expires; a new link closes the old ones; nothing here says whether an
 * address has an account; verification never signs anyone in; a reset ends
 * every session through `session_epoch`. SMTP and HIBP are in-process fakes;
 * the outbox is what the app would have emailed.
 */

import { createHash } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';

process.env.RATE_LIMIT_STORE = 'memory';

const { createApp } = await import('../../src/app.js');
const { config } = await import('../../src/config/index.js');
const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { closeRedis } = await import('../../src/lib/redis.js');
const { createSessionStore } = await import('../../src/lib/session-store.js');
const { REQUEST_LOG_SERIALIZERS } = await import('../../src/middleware/request-context.js');
const { issueCsrfToken } = await import('../../src/services/csrf.service.js');

const ORIGIN = new URL(config.baseUrl).origin;
const PASSWORD = 'zq-a-long-unbreached-passphrase';
const NEW_PASSWORD = 'zq-another-long-unbreached-one';
const BREACHED_SET = new Set(['password123-breached']);
const UNREACHABLE_SET = new Set(['hibp-is-down-please']);

let outbox = [];
async function fakeHibp(password) {
  if (UNREACHABLE_SET.has(password)) throw new Error('HIBP unreachable');
  return BREACHED_SET.has(password);
}
const newApp = () =>
  createApp({ isBreachedPassword: fakeHibp, sendMail: async (message) => void outbox.push(message) });

const createdUsernames = [];
const anonymousIds = [];
const newUsername = () => {
  const name = `zzm${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`;
  createdUsernames.push(name.toLowerCase());
  return name;
};
const newEmail = () => `zzm-${generateAnonymousId().slice(0, 13)}@Example.test`;
const newAnonymousId = () => {
  const id = generateAnonymousId();
  anonymousIds.push(id);
  return id;
};

function postForm(app, path, fields, { anonymousId = newAnonymousId(), csrf, sessionId } = {}) {
  const token = csrf === undefined ? issueCsrfToken(config.csrf.secret, anonymousId) : csrf;
  const cookies = [`pa_uid=${anonymousId}`, ...(sessionId ? [`pa_sid=${sessionId}`] : [])];
  const body = new URLSearchParams({ ...fields, ...(token ? { _csrf: token } : {}) });
  return request(app).post(path).set('Cookie', cookies).set('Origin', ORIGIN).type('form').send(body.toString());
}

const register = (app, { username = newUsername(), email, password = PASSWORD, ack } = {}) =>
  postForm(app, '/register', {
    username,
    email: email ?? '',
    password,
    ...(ack ? { acknowledgeNoRecovery: 'yes' } : {}),
    'cf-turnstile-response': 'a-token',
  });
const login = (app, identifier, password = PASSWORD, options) =>
  postForm(app, '/login', { identifier, password, 'cf-turnstile-response': 'a-token' }, options);
const requestReset = (app, email, fields = {}) =>
  postForm(app, '/reset-password', { email, 'cf-turnstile-response': 'a-token', ...fields });
const confirmReset = (app, token, password = NEW_PASSWORD) => postForm(app, '/reset-password/confirm', { token, password });

/** The token in the last email sent to an address. */
function lastLinkTo(email, path) {
  const message = outbox.filter((entry) => entry.to.toLowerCase() === email.toLowerCase()).at(-1);
  if (!message) return null;
  const marker = `${path}?token=`;
  const at = message.text.indexOf(marker);
  return at === -1 ? null : message.text.slice(at + marker.length).match(/^[A-Za-z0-9_-]+/)[0];
}
const verificationTokenFor = (email) => lastLinkTo(email, '/verify-email');
const resetTokenFor = (email) => lastLinkTo(email, '/reset-password/confirm');

const setCookieLine = (response, name) =>
  [response.headers['set-cookie'] ?? []].flat().find((line) => line.startsWith(`${name}=`));
const sessionOf = (response) => setCookieLine(response, 'pa_sid')?.split(';')[0].split('=')[1] ?? null;

async function accountByEmail(email) {
  const [rows] = await getPool().execute(
    `SELECT u.user_id, u.session_epoch, a.email, a.email_verified_at, a.password_hash
       FROM user_accounts a JOIN users u ON u.user_id = a.user_id WHERE a.email_lower = ?`,
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}
async function tokensOf(userId, type) {
  const [rows] = await getPool().execute(
    'SELECT token_hash, expires_at, consumed_at FROM auth_tokens WHERE user_id = ? AND token_type = ? ORDER BY token_id',
    [userId, type],
  );
  return rows;
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** A registered, verified email account. */
async function verifiedAccount(app) {
  const email = newEmail();
  const username = newUsername();
  await register(app, { username, email });
  await request(app).get(`/verify-email?token=${verificationTokenFor(email)}`);
  return { email, username };
}

beforeEach(() => {
  outbox = [];
});

afterAll(async () => {
  const pool = getPool();
  for (const name of createdUsernames) {
    const [users] = await pool.execute('SELECT user_id FROM users WHERE username_lower = ?', [name]);
    for (const { user_id: userId } of users) {
      await pool.execute('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM consent_records WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM user_accounts WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM identity_bindings WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM users WHERE user_id = ?', [userId]);
      await createSessionStore().destroyAllForUser(Number(userId));
    }
  }
  for (const id of anonymousIds) await pool.execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [id]);
  await closePool();
  await closeRedis();
});

describe('FR-AUTH-04b / FR-AUTH-09 — registering with an email', () => {
  test('one account, unverified, one verification email, and no sign-in', async () => {
    const app = newApp();
    const email = newEmail();
    const response = await register(app, { email });

    expect(response.status).toBe(200);
    expect(response.text).toContain('We have sent you a link to confirm your email address.');
    expect(setCookieLine(response, 'pa_sid')).toBeUndefined();

    const account = await accountByEmail(email);
    expect(account.email).toBe(email);
    expect(account.email_verified_at).toBeNull();
    expect(outbox.filter((message) => message.to === email)).toHaveLength(1);
    // No acknowledgement: this account can be recovered.
    const [consents] = await getPool().execute('SELECT 1 FROM consent_records WHERE user_id = ?', [account.user_id]);
    expect(consents).toHaveLength(0);
  });

  test('only the hash of the token is stored; the raw token is only in the email', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });
    const raw = verificationTokenFor(email);
    const { user_id: userId } = await accountByEmail(email);
    const [row] = await tokensOf(userId, 'email_verification');

    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.token_hash).toBe(sha256(raw));
    expect(JSON.stringify(row)).not.toContain(raw);
    expect(row.expires_at.getTime() - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000);
  });

  test('a used address and a malformed one get the same generic refusal (FR-AUTH-06)', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });

    const taken = await register(app, { email: email.toUpperCase() });
    const malformed = await register(app, { email: 'not-an-address' });

    expect(taken.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(taken.text).toContain('This email cannot be used for registration.');
    expect(malformed.text).toContain('This email cannot be used for registration.');
    const [rows] = await getPool().execute('SELECT COUNT(*) AS n FROM user_accounts WHERE email_lower = ?', [
      email.toLowerCase(),
    ]);
    expect(Number(rows[0].n)).toBe(1);
  });

  test('without an email, the no-recovery acknowledgement is still required', async () => {
    expect((await register(newApp(), {})).status).toBe(400);
    expect((await register(newApp(), { ack: true })).status).toBe(303);
  });
});

describe('FR-AUTH-09 / FR-AUTH-13 — signing in before verifying', () => {
  test('the right password says "confirm your email" and offers a resend; no session', async () => {
    const app = newApp();
    const email = newEmail();
    const username = newUsername();
    await register(app, { username, email });

    for (const identifier of [username, email]) {
      const response = await login(app, identifier);
      expect(response.status).toBe(403);
      expect(response.text).toContain('Please confirm your email address before signing in.');
      expect(response.text).toContain('action="/verify-email/resend"');
      expect(setCookieLine(response, 'pa_sid')).toBeUndefined();
    }
  });

  test('a wrong password on an unverified account is the one generic failure — no hint', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });

    const response = await login(app, email, 'not the password at all');
    expect(response.status).toBe(401);
    expect(response.text).toContain('Invalid username/email or password');
    expect(response.text).not.toContain('confirm your email');
  });
});

describe('FR-AUTH-09 — the verification link', () => {
  test('verifies, never signs in, and then sign-in works by email or username', async () => {
    const app = newApp();
    const email = newEmail();
    const username = newUsername();
    await register(app, { username, email });

    const response = await request(app).get(`/verify-email?token=${verificationTokenFor(email)}`);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/verify-email?status=verified');
    expect(setCookieLine(response, 'pa_sid')).toBeUndefined();
    expect((await accountByEmail(email)).email_verified_at).not.toBeNull();

    expect(sessionOf(await login(app, email))).toBeTruthy();
    expect(sessionOf(await login(app, username))).toBeTruthy();
  });

  test('a link works once', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });
    const token = verificationTokenFor(email);

    await request(app).get(`/verify-email?token=${token}`);
    const [first] = await tokensOf((await accountByEmail(email)).user_id, 'email_verification');
    const again = await request(app).get(`/verify-email?token=${token}`);

    // The second use changes nothing; the person is told the address is confirmed.
    expect(again.headers.location).toBe('/verify-email?status=already-verified');
    const [after] = await tokensOf((await accountByEmail(email)).user_id, 'email_verification');
    expect(after.consumed_at).toEqual(first.consumed_at);
  });

  test('an expired link does not verify', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });
    const { user_id: userId } = await accountByEmail(email);
    await getPool().execute(
      "UPDATE auth_tokens SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE user_id = ? AND token_type = 'email_verification'",
      [userId],
    );

    const response = await request(app).get(`/verify-email?token=${verificationTokenFor(email)}`);
    expect(response.headers.location).toBe('/verify-email?status=expired');
    expect((await accountByEmail(email)).email_verified_at).toBeNull();
    const page = await request(app).get('/verify-email?status=expired');
    expect(page.status).toBe(400);
    expect(page.text).toContain('This link has expired');
  });

  test.each(['', 'short', 'x'.repeat(43), '../../etc', `${'A'.repeat(42)}!`])('malformed or unknown token %p fails safely', async (token) => {
    const response = await request(newApp()).get(`/verify-email?token=${encodeURIComponent(token)}`);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/verify-email?status=invalid');
  });

  test('the result page carries no token, and the token URL is never logged whole', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });
    const token = verificationTokenFor(email);
    const response = await request(app).get(`/verify-email?token=${token}`);

    expect(response.headers.location).not.toContain(token);
    expect(response.headers['referrer-policy']).toBe('strict-origin');
    const logged = REQUEST_LOG_SERIALIZERS.req({ id: 'c', method: 'GET', url: `/verify-email?token=${token}` });
    expect(JSON.stringify(logged)).not.toContain(token);
  });
});

describe('FR-AUTH-10 — resending the verification link', () => {
  test('a new link closes the old one', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });
    const oldToken = verificationTokenFor(email);

    await postForm(app, '/verify-email/resend', { email });
    const newToken = verificationTokenFor(email);
    expect(newToken).not.toBe(oldToken);

    expect((await request(app).get(`/verify-email?token=${oldToken}`)).headers.location).toBe('/verify-email?status=invalid');
    expect((await request(app).get(`/verify-email?token=${newToken}`)).headers.location).toBe('/verify-email?status=verified');
  });

  test('the same answer for an unknown, a verified and an unverified address; only the last gets mail', async () => {
    const app = newApp();
    const pending = newEmail();
    await register(app, { email: pending });
    const { email: verified } = await verifiedAccount(app);
    outbox = [];

    const answers = [];
    for (const email of ['zzm-nobody@example.test', verified, pending]) {
      const response = await postForm(app, '/verify-email/resend', { email });
      answers.push([response.status, response.text.replace(/value="[^"]*"/g, '')]);
    }
    expect(new Set(answers.map(JSON.stringify)).size).toBe(1);
    expect(outbox.map((message) => message.to)).toEqual([pending]);
  });

  test('3 per hour per account, then 429 — for unknown addresses too', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await postForm(app, '/verify-email/resend', { email })).status).toBe(200);
    }
    // Case-insensitive: the same account whatever the case.
    expect((await postForm(app, '/verify-email/resend', { email: email.toUpperCase() })).status).toBe(429);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await postForm(app, '/verify-email/resend', { email: 'zzm-ghost@example.test' });
    }
    expect((await postForm(app, '/verify-email/resend', { email: 'zzm-ghost@example.test' })).status).toBe(429);
  });

  test('without a CSRF token: 403, no mail', async () => {
    const app = newApp();
    const email = newEmail();
    await register(app, { email });
    outbox = [];
    expect((await postForm(app, '/verify-email/resend', { email }, { csrf: null })).status).toBe(403);
    expect(outbox).toHaveLength(0);
  });
});

describe('FR-AUTH-11 — requesting a reset', () => {
  test('the same answer whether or not the address has an account; mail only for a verified one', async () => {
    const app = newApp();
    const { email: verified } = await verifiedAccount(app);
    const unverified = newEmail();
    await register(app, { email: unverified });
    outbox = [];

    const bodies = [];
    for (const email of ['zzm-nobody@example.test', unverified, verified]) {
      const response = await requestReset(app, email);
      expect(response.status).toBe(200);
      bodies.push(response.text.replace(/value="[^"]*"/g, ''));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(outbox.map((message) => message.to)).toEqual([verified]);
    expect(resetTokenFor(verified)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('Turnstile is required (FR-AUTH-14)', async () => {
    const app = newApp();
    const { email } = await verifiedAccount(app);
    outbox = [];
    expect((await requestReset(app, email, { 'cf-turnstile-response': '' })).status).toBe(400);
    expect(outbox).toHaveLength(0);
  });

  test('3 per hour per address, case-insensitively, then 429 (FR-AUTH-15)', async () => {
    const app = newApp();
    const email = 'zzm-limit@example.test';
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await requestReset(app, email)).status).toBe(200);
    const denied = await requestReset(app, email.toUpperCase());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('a newer link closes the older one', async () => {
    const app = newApp();
    const { email } = await verifiedAccount(app);
    await requestReset(app, email);
    const older = resetTokenFor(email);
    await requestReset(app, email);
    const newer = resetTokenFor(email);

    expect((await request(app).get(`/reset-password/confirm?token=${older}`)).text).toContain('cannot be used');
    expect((await request(app).get(`/reset-password/confirm?token=${newer}`)).text).toContain('Choose a new password');
  });
});

describe('FR-AUTH-11 — setting the new password', () => {
  test('changes the password, ends every session, closes the link and sends a notice', async () => {
    const app = newApp();
    const { email, username } = await verifiedAccount(app);
    const before = await accountByEmail(email);
    const phone = sessionOf(await login(app, username));
    const laptop = sessionOf(await login(app, email));
    await requestReset(app, email);
    const token = resetTokenFor(email);
    outbox = [];

    const form = await request(app).get(`/reset-password/confirm?token=${token}`);
    expect(form.headers['referrer-policy']).toBe('strict-origin');
    expect(form.text).toContain(`name="token" value="${token}"`);

    const response = await confirmReset(app, token);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/login?password-reset=1');
    expect(setCookieLine(response, 'pa_sid')).toBeUndefined();

    const after = await accountByEmail(email);
    expect(after.session_epoch).toBe(before.session_epoch + 1);
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(after.password_hash).toMatch(/^\$2b\$12\$/);

    // Both earlier sessions are over.
    for (const sessionId of [phone, laptop]) {
      const page = await request(app).get('/login').set('Cookie', [`pa_uid=${newAnonymousId()}`, `pa_sid=${sessionId}`]);
      expect(page.text).not.toContain('Signed in as');
    }
    // The old password no longer works; the new one does.
    expect((await login(app, email)).status).toBe(401);
    expect(sessionOf(await login(app, email, NEW_PASSWORD))).toBeTruthy();
    // The link is spent, and the owner is told.
    expect((await confirmReset(app, token, 'zq-yet-another-passphrase')).status).toBe(400);
    expect(outbox.map((message) => message.subject)).toEqual(['Your PronounceAll password was changed']);
  });

  test('an expired link is refused and changes nothing', async () => {
    const app = newApp();
    const { email } = await verifiedAccount(app);
    await requestReset(app, email);
    const { user_id: userId, password_hash: hash } = await accountByEmail(email);
    await getPool().execute(
      "UPDATE auth_tokens SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE user_id = ? AND token_type = 'password_reset'",
      [userId],
    );

    const page = await request(app).get(`/reset-password/confirm?token=${resetTokenFor(email)}`);
    expect(page.status).toBe(400);
    expect(page.text).toContain('This reset link has expired');
    expect((await confirmReset(app, resetTokenFor(email))).status).toBe(400);
    expect((await accountByEmail(email)).password_hash).toBe(hash);
  });

  test('a breached or uncheckable new password leaves the link usable', async () => {
    const app = newApp();
    const { email } = await verifiedAccount(app);
    await requestReset(app, email);
    const token = resetTokenFor(email);

    const breached = await confirmReset(app, token, 'password123-breached');
    expect(breached.status).toBe(400);
    expect(breached.text).toContain('appeared in a known breach');

    const unavailable = await confirmReset(app, token, 'hibp-is-down-please');
    expect(unavailable.status).toBe(503);
    expect(unavailable.text).toContain('Please try again shortly.');

    expect((await confirmReset(app, token)).status).toBe(303);
  });

  test('two uses of one link at once: exactly one succeeds', async () => {
    const app = newApp();
    const { email } = await verifiedAccount(app);
    await requestReset(app, email);
    const token = resetTokenFor(email);
    const before = await accountByEmail(email);

    const results = await Promise.all([confirmReset(app, token), confirmReset(app, token, 'zq-a-different-passphrase')]);
    expect(results.map((response) => response.status).sort()).toEqual([303, 400]);
    expect((await accountByEmail(email)).session_epoch).toBe(before.session_epoch + 1);
  });

  test.each(['', 'nope', 'A'.repeat(43)])('malformed or unknown token %p: refused, nothing changes', async (token) => {
    const response = await confirmReset(newApp(), token);
    expect(response.status).toBe(400);
    expect(response.text).toContain('cannot be used');
  });

  test('without a CSRF token: 403', async () => {
    const app = newApp();
    const { email } = await verifiedAccount(app);
    await requestReset(app, email);
    const response = await postForm(app, '/reset-password/confirm', { token: resetTokenFor(email), password: NEW_PASSWORD }, { csrf: null });
    expect(response.status).toBe(403);
  });
});
