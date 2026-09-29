/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Accounts, Iteration 4 slice 1: username registration, sign-in, sessions,
 * sign-out, and the anonymous-to-account merge (FR-AUTH-04/05/07/08/12/13/14/
 * 15/18/19/20, FR-CONSENT-04, FR-SET-06; SDD v1.1 §5.1, §5.6, V3).
 *
 * The invariants, not the happy path: one row per insert and none on any
 * refusal; one generic message for every failed sign-in; a session that stops
 * authorising the moment the MySQL epoch moves; latest-event-wins across the
 * merged identities; one LINK per anonymous identity, never a second.
 *
 * HIBP is replaced by an in-process fake. Rate-limit counters are in-memory and
 * belong to one app instance, so tests that register build their own app: the
 * registration limit is per IP, and every request here comes from one.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

process.env.RATE_LIMIT_STORE = 'memory';

const { createApp } = await import('../../src/app.js');
const { config } = await import('../../src/config/index.js');
const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { closeRedis, getRedis } = await import('../../src/lib/redis.js');
const { createSessionStore } = await import('../../src/lib/session-store.js');
const { issueCsrfToken, issueCsrfTokenFor } = await import('../../src/services/csrf.service.js');
const { createSessionService, SESSION_IDLE_SECONDS } = await import('../../src/services/session.service.js');

const ORIGIN = new URL(config.baseUrl).origin;
const PASSWORD = 'correct horse battery staple';
const BREACHED = 'password123-breached';

/** HIBP stand-in: one known-breached password, and one that makes the API fail. */
const BREACHED_SET = new Set([BREACHED]);
const UNREACHABLE_SET = new Set(['hibp-is-down-please']);
async function fakeHibp(password) {
  if (UNREACHABLE_SET.has(password)) throw new Error('HIBP unreachable');
  return BREACHED_SET.has(password);
}

const newApp = () => createApp({ isBreachedPassword: fakeHibp });

const createdUsernames = [];
const anonymousIds = [];
let wordId;

const newUsername = () => {
  const name = `zzt${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`;
  createdUsernames.push(name.toLowerCase());
  return name;
};
const newAnonymousId = () => {
  const id = generateAnonymousId();
  anonymousIds.push(id);
  return id;
};

/** @returns {Record<string,string>} cookie name → value from a response */
function cookiesOf(response) {
  const jar = {};
  for (const line of [response.headers['set-cookie'] ?? []].flat()) {
    const [pair] = line.split(';');
    const [name, ...rest] = pair.split('=');
    jar[name] = rest.join('=');
  }
  return jar;
}
const setCookieLine = (response, name) =>
  [response.headers['set-cookie'] ?? []].flat().find((line) => line.startsWith(`${name}=`));

/** A form POST as a signed-out browser carrying `pa_uid` would send it. */
function postForm(app, path, anonymousId, fields, { csrf, origin = ORIGIN, sessionId } = {}) {
  const token = csrf === undefined ? issueCsrfToken(config.csrf.secret, anonymousId) : csrf;
  const cookies = [`pa_uid=${anonymousId}`, ...(sessionId ? [`pa_sid=${sessionId}`] : [])];
  let call = request(app).post(path).set('Cookie', cookies).type('form');
  if (origin) call = call.set('Origin', origin);
  const body = new URLSearchParams({ ...fields, ...(token ? { _csrf: token } : {}) });
  return call.send(body.toString());
}

function register(app, anonymousId, overrides = {}) {
  return postForm(app, '/register', anonymousId, {
    username: overrides.username ?? newUsername(),
    password: overrides.password ?? PASSWORD,
    acknowledgeNoRecovery: 'yes',
    'cf-turnstile-response': 'a-token',
    ...overrides.fields,
  }, overrides.options);
}

function login(app, anonymousId, identifier, password = PASSWORD, options = {}) {
  return postForm(
    app,
    '/login',
    anonymousId,
    { identifier, password, 'cf-turnstile-response': 'a-token' },
    options,
  );
}

async function rowsFor(username) {
  const [users] = await getPool().execute('SELECT user_id, username, session_epoch FROM users WHERE username_lower = ?', [
    username.toLowerCase(),
  ]);
  if (users.length === 0) return { users, accounts: [], consents: [] };
  const userId = users[0].user_id;
  const [accounts] = await getPool().execute('SELECT * FROM user_accounts WHERE user_id = ?', [userId]);
  const [consents] = await getPool().execute('SELECT * FROM consent_records WHERE user_id = ?', [userId]);
  return { users, accounts, consents, userId: Number(userId) };
}

/** A JSON save as the page script sends it. */
function save(app, { anonymousId, sessionId, action = 'save', tag, csrf }) {
  const token =
    csrf ?? (sessionId ? issueCsrfTokenFor(config.csrf.secret, { sessionId }) : issueCsrfToken(config.csrf.secret, anonymousId));
  const cookies = [`pa_uid=${anonymousId}`, ...(sessionId ? [`pa_sid=${sessionId}`] : [])];
  return request(app)
    .post('/save')
    .set('Cookie', cookies)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', token)
    .send({
      action,
      targetKind: 'word',
      targetId: wordId,
      ...(tag ? { tag } : {}),
      idempotencyKey: generateAnonymousId().replaceAll('-', ''),
    });
}

beforeAll(async () => {
  const [[word]] = await getPool().execute("SELECT word_id FROM words WHERE normalized_headword = 'cupcake'");
  wordId = Number(word.word_id);
});

afterAll(async () => {
  const pool = getPool();
  for (const name of createdUsernames) {
    const [users] = await pool.execute('SELECT user_id FROM users WHERE username_lower = ?', [name]);
    for (const { user_id: userId } of users) {
      await pool.execute('DELETE FROM consent_records WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM user_accounts WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM user_word_states WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM user_phoneme_states WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM user_activity_events WHERE user_id = ?', [userId]);
      const [bound] = await pool.execute('SELECT anonymous_id FROM identity_bindings WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM identity_bindings WHERE user_id = ?', [userId]);
      anonymousIds.push(...bound.map((row) => row.anonymous_id));
      await pool.execute('DELETE FROM users WHERE user_id = ?', [userId]);
      await createSessionStore().destroyAllForUser(Number(userId));
    }
  }
  for (const id of anonymousIds) {
    await pool.execute('DELETE FROM user_word_states WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM user_activity_events WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [id]);
  }
  await closePool();
  await closeRedis();
});

describe('FR-AUTH-04 / FR-CONSENT-04 — username registration', () => {
  test('one users row, one password credential at bcrypt cost 12, one acknowledgement', async () => {
    const username = newUsername();
    const response = await register(newApp(), newAnonymousId(), { username });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/login?signed-in=1');

    const rows = await rowsFor(username);
    expect(rows.users).toHaveLength(1);
    expect(rows.users[0].username).toBe(username);
    expect(rows.accounts).toHaveLength(1);
    expect(rows.accounts[0]).toMatchObject({ provider: 'password', email: null, google_sub: null });
    expect(rows.accounts[0].password_hash).toMatch(/^\$2b\$12\$/);
    expect(rows.consents).toHaveLength(1);
    expect(rows.consents[0]).toMatchObject({ consent_type: 'no_recovery_ack', consent_value: 'acknowledged' });
  });

  test('registering signs in: pa_sid is HttpOnly, SameSite=Lax, Path=/', async () => {
    const response = await register(newApp(), newAnonymousId());
    const line = setCookieLine(response, 'pa_sid');

    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Path=\//);
    expect(cookiesOf(response).pa_sid.length).toBeGreaterThanOrEqual(43);
  });

  test('without the no-recovery acknowledgement: refused, nothing written', async () => {
    const username = newUsername();
    const response = await register(newApp(), newAnonymousId(), { username, fields: { acknowledgeNoRecovery: '' } });

    expect(response.status).toBe(400);
    expect((await rowsFor(username)).users).toHaveLength(0);
  });

  test('usernames that differ only in case cannot coexist', async () => {
    const app = newApp();
    const username = newUsername();
    await register(app, newAnonymousId(), { username });
    const again = await register(app, newAnonymousId(), { username: username.toUpperCase() });

    expect(again.status).toBe(409);
    expect(again.text).toContain('That username is already taken.');
    expect((await rowsFor(username)).users).toHaveLength(1);
  });

  test.each([
    ['', 400],
    ['ab', 400],
    ['1abc', 400],
    ['root', 400],
  ])('username %p is refused and nothing is written', async (username, status) => {
    const response = await register(newApp(), newAnonymousId(), { username });
    expect(response.status).toBe(status);
    if (username) expect((await rowsFor(username)).users).toHaveLength(0);
  });
});

describe('FR-AUTH-07 — password policy', () => {
  test.each([
    ['1234567', /at least 8/],
    ['x'.repeat(101), /at most 100/],
    [BREACHED, /appeared in a known breach/],
  ])('%p is refused with its message', async (password, message) => {
    const username = newUsername();
    const response = await register(newApp(), newAnonymousId(), { username, password });

    expect(response.status).toBe(400);
    expect(response.text).toMatch(message);
    expect((await rowsFor(username)).users).toHaveLength(0);
  });

  test('when the breach check cannot run, registration fails closed', async () => {
    const username = newUsername();
    const response = await register(newApp(), newAnonymousId(), { username, password: 'hibp-is-down-please' });

    expect(response.status).toBe(500);
    expect((await rowsFor(username)).users).toHaveLength(0);
  });

  test('the password never appears in any response', async () => {
    const response = await register(newApp(), newAnonymousId(), { password: BREACHED });
    expect(response.text).not.toContain(BREACHED);
  });
});

describe('FR-AUTH-14 / FR-AUTH-20 / FR-AUTH-15 — gates on the forms', () => {
  test('no Turnstile token: 400 on register and login, nothing written', async () => {
    const username = newUsername();
    const app = newApp();
    expect((await register(app, newAnonymousId(), { username, fields: { 'cf-turnstile-response': '' } })).status).toBe(400);
    expect((await rowsFor(username)).users).toHaveLength(0);
    expect(
      (await postForm(app, '/login', newAnonymousId(), { identifier: 'x', password: 'y' })).status,
    ).toBe(400);
  });

  test('no or foreign CSRF token, or a foreign origin: 403', async () => {
    const app = newApp();
    const username = newUsername();
    expect((await register(app, newAnonymousId(), { username, options: { csrf: null } })).status).toBe(403);
    expect(
      (await register(app, newAnonymousId(), { username, options: { csrf: issueCsrfToken(config.csrf.secret, newAnonymousId()) } }))
        .status,
    ).toBe(403);
    expect((await register(app, newAnonymousId(), { username, options: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await rowsFor(username)).users).toHaveLength(0);
  });

  test('register: 3 per hour per IP, then 429 with Retry-After', async () => {
    const app = newApp();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await register(app, newAnonymousId())).status).toBe(303);
    }
    const denied = await register(app, newAnonymousId());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('login: the 6th attempt in 15 minutes from one UUID + IP is 429', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(app, anonymousId, 'zztnosuchuser', 'wrong password')).status).toBe(401);
    }
    const denied = await login(app, anonymousId, 'zztnosuchuser', 'wrong password');
    expect(denied.status).toBe(429);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThanOrEqual(0);
    // A different UUID from the same IP has its own budget.
    expect((await login(app, newAnonymousId(), 'zztnosuchuser', 'wrong password')).status).toBe(401);
  });
});

describe('FR-AUTH-13 — sign-in and its one generic error', () => {
  let app;
  let username;

  beforeAll(async () => {
    app = newApp();
    username = newUsername();
    await register(app, newAnonymousId(), { username });
  });

  test('the right password signs in, case-insensitively on the username', async () => {
    const response = await login(app, newAnonymousId(), username.toUpperCase());
    expect(response.status).toBe(303);
    expect(cookiesOf(response).pa_sid).toBeTruthy();
  });

  test('an unknown user and a wrong password are indistinguishable', async () => {
    const unknownStart = Date.now();
    const unknown = await login(app, newAnonymousId(), 'zztnobodyatall');
    const unknownMs = Date.now() - unknownStart;
    const wrongStart = Date.now();
    const wrong = await login(app, newAnonymousId(), username, 'not the password');
    const wrongMs = Date.now() - wrongStart;

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    for (const response of [unknown, wrong]) {
      expect(response.text).toContain('Invalid username/email or password');
      expect(response.headers['set-cookie'] ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/^pa_sid=/)]));
    }
    // Both paths ran a bcrypt comparison at cost 12 (tens of milliseconds).
    expect(unknownMs).toBeGreaterThan(20);
    expect(wrongMs).toBeGreaterThan(20);
  });

  test('every sign-in issues a new session id (rotation on login)', async () => {
    const first = cookiesOf(await login(app, newAnonymousId(), username)).pa_sid;
    const second = cookiesOf(await login(app, newAnonymousId(), username)).pa_sid;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

describe('FR-AUTH-12 / V3 — sessions', () => {
  let app;
  let username;

  beforeAll(async () => {
    app = newApp();
    username = newUsername();
    await register(app, newAnonymousId(), { username });
  });

  const signIn = async () => cookiesOf(await login(app, newAnonymousId(), username)).pa_sid;
  const whoAmI = async (sessionId) =>
    (await request(app).get('/login').set('Cookie', [`pa_uid=${newAnonymousId()}`, `pa_sid=${sessionId}`])).text;

  test('a live session is recognised on the next request', async () => {
    expect(await whoAmI(await signIn())).toContain(`Signed in as <strong>${username}</strong>`);
  });

  test('moving users.session_epoch ends every session at once', async () => {
    const a = await signIn();
    const b = await signIn();
    await getPool().execute('UPDATE users SET session_epoch = session_epoch + 1 WHERE username_lower = ?', [
      username.toLowerCase(),
    ]);
    expect(await whoAmI(a)).not.toContain('Signed in as');
    expect(await whoAmI(b)).not.toContain('Signed in as');
    // A fresh sign-in, validated against the new epoch, works again.
    expect(await whoAmI(await signIn())).toContain('Signed in as');
  });

  test('an unknown or garbage pa_sid is simply signed out', async () => {
    expect(await whoAmI('not-a-real-session')).toContain('Sign in');
  });

  test('the Redis record never outlives the idle window', async () => {
    const sessionId = await signIn();
    const { createHash } = await import('node:crypto');
    const ttl = await getRedis().ttl(`session:${createHash('sha256').update(sessionId).digest('hex')}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SESSION_IDLE_SECONDS);
  });

  test('the absolute limit ends a session after 12 hours regardless of activity', async () => {
    const { userId, users } = await rowsFor(username);
    let clock = Date.now();
    const service = createSessionService({ store: createSessionStore(), now: () => clock });
    const sessionId = await service.startSession(userId, Number(users[0].session_epoch));

    clock += 11 * 60 * 60 * 1000;
    expect(await service.resolveSession(sessionId)).toMatchObject({ userId });
    clock += 60 * 60 * 1000;
    expect(await service.resolveSession(sessionId)).toBeNull();
  });

  test('the Redis key is a hash, never the cookie value', async () => {
    const sessionId = await signIn();
    expect(await getRedis().exists(`session:${sessionId}`)).toBe(0);
  });
});

describe('FR-SET-06 — sign-out', () => {
  test('ends the session, clears pa_sid with Max-Age=0, keeps pa_uid', async () => {
    const app = newApp();
    const username = newUsername();
    await register(app, newAnonymousId(), { username });
    const anonymousId = newAnonymousId();
    const sessionId = cookiesOf(await login(app, anonymousId, username)).pa_sid;

    const response = await postForm(app, '/logout', anonymousId, {}, {
      sessionId,
      csrf: issueCsrfTokenFor(config.csrf.secret, { sessionId }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/');
    expect(setCookieLine(response, 'pa_sid')).toMatch(/Max-Age=0/);
    const uid = cookiesOf(response).pa_uid;
    if (uid !== undefined) expect(uid).toBe(anonymousId);

    const after = await request(app).get('/login').set('Cookie', [`pa_uid=${anonymousId}`, `pa_sid=${sessionId}`]);
    expect(after.text).not.toContain('Signed in as');
  });

  test('a session-bound sign-out refuses an anonymous token', async () => {
    const app = newApp();
    const username = newUsername();
    await register(app, newAnonymousId(), { username });
    const anonymousId = newAnonymousId();
    const sessionId = cookiesOf(await login(app, anonymousId, username)).pa_sid;

    const response = await postForm(app, '/logout', anonymousId, {}, { sessionId });
    expect(response.status).toBe(403);
  });
});

describe('FR-AUTH-18 / FR-AUTH-19 — the merge', () => {
  const stateOf = async (userId) => {
    const [rows] = await getPool().execute('SELECT state FROM user_word_states WHERE user_id = ? AND word_id = ?', [
      userId,
      wordId,
    ]);
    return rows[0]?.state ?? 'unsaved';
  };
  const bindingsOf = async (userId) =>
    (await getPool().execute('SELECT anonymous_id FROM identity_bindings WHERE user_id = ? ORDER BY binding_id', [userId]))[0].map(
      (row) => row.anonymous_id,
    );

  test('a visitor without a progress profile: no LINK, pa_uid kept', async () => {
    const anonymousId = newAnonymousId();
    const username = newUsername();
    const response = await register(newApp(), anonymousId, { username });

    const { userId } = await rowsFor(username);
    expect(await bindingsOf(userId)).toEqual([]);
    const uid = cookiesOf(response).pa_uid;
    if (uid !== undefined) expect(uid).toBe(anonymousId);
  });

  test('registering with anonymous progress: one LINK, state merged, pa_uid retired', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    await save(app, { anonymousId });
    await save(app, { anonymousId, action: 'tag', tag: 'learning' });

    const username = newUsername();
    const response = await register(app, anonymousId, { username });
    const { userId } = await rowsFor(username);

    expect(await bindingsOf(userId)).toEqual([anonymousId]);
    expect(await stateOf(userId)).toBe('learning');
    const fresh = cookiesOf(response).pa_uid;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(anonymousId);
    anonymousIds.push(fresh);

    // The past events are untouched: still owned by the anonymous identity.
    const [events] = await getPool().execute(
      'SELECT COUNT(*) AS n FROM user_activity_events WHERE anonymous_id = ? AND user_id IS NULL',
      [anonymousId],
    );
    expect(Number(events[0].n)).toBe(2);
  });

  test('the later event wins: account learned at T0, anonymous learning at T1 → learning', async () => {
    const app = newApp();
    const username = newUsername();
    const sessionId = cookiesOf(await register(app, newAnonymousId(), { username })).pa_sid;
    const { userId } = await rowsFor(username);

    // T0: the account tags the word learned.
    await save(app, { anonymousId: newAnonymousId(), sessionId });
    await save(app, { anonymousId: newAnonymousId(), sessionId, action: 'tag', tag: 'learned' });
    expect(await stateOf(userId)).toBe('learned');

    // T1: elsewhere, signed out, the same word is tagged learning.
    const device = newAnonymousId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await save(app, { anonymousId: device });
    await save(app, { anonymousId: device, action: 'tag', tag: 'learning' });

    await login(app, device, username);
    expect(await stateOf(userId)).toBe('learning');
  });

  test('the earlier anonymous event loses to the account’s later one', async () => {
    const app = newApp();
    const device = newAnonymousId();
    await save(app, { anonymousId: device });
    await save(app, { anonymousId: device, action: 'tag', tag: 'learning' });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const username = newUsername();
    const sessionId = cookiesOf(await register(app, newAnonymousId(), { username })).pa_sid;
    await save(app, { anonymousId: newAnonymousId(), sessionId });
    await save(app, { anonymousId: newAnonymousId(), sessionId, action: 'tag', tag: 'learned' });

    await login(app, device, username);
    const { userId } = await rowsFor(username);
    expect(await stateOf(userId)).toBe('learned');
  });

  test('two devices bind to one account; an identity is never linked twice', async () => {
    const app = newApp();
    const username = newUsername();
    await register(app, newAnonymousId(), { username });
    const { userId } = await rowsFor(username);

    const phone = newAnonymousId();
    const laptop = newAnonymousId();
    await save(app, { anonymousId: phone });
    await save(app, { anonymousId: laptop });
    await login(app, phone, username);
    await login(app, laptop, username);
    // The phone's retired identity comes back (e.g. restored from its mirror).
    await login(app, phone, username);

    expect((await bindingsOf(userId)).sort()).toEqual([phone, laptop].sort());
  });

  test('an identity already bound to another account stays with that account', async () => {
    const app = newApp();
    const first = newUsername();
    const second = newUsername();
    const device = newAnonymousId();
    await save(app, { anonymousId: device });
    await register(app, device, { username: first });
    await register(app, newAnonymousId(), { username: second });

    const response = await login(app, device, second);
    expect(response.status).toBe(303);
    expect(await bindingsOf((await rowsFor(second)).userId)).toEqual([]);
    expect(await bindingsOf((await rowsFor(first)).userId)).toEqual([device]);
  });
});

describe('signed-in writes and reads belong to the account', () => {
  test('a save with a session is owned by user_id; an anonymous token is refused', async () => {
    const app = newApp();
    const username = newUsername();
    const anonymousId = newAnonymousId();
    const sessionId = cookiesOf(await register(app, anonymousId, { username })).pa_sid;
    const { userId } = await rowsFor(username);

    expect((await save(app, { anonymousId, sessionId, csrf: issueCsrfToken(config.csrf.secret, anonymousId) })).status).toBe(403);
    expect((await save(app, { anonymousId, sessionId })).status).toBe(200);

    const [events] = await getPool().execute(
      "SELECT anonymous_id, user_id FROM user_activity_events WHERE user_id = ? AND event_type = 'save'",
      [userId],
    );
    expect(events).toEqual([{ anonymous_id: null, user_id: userId }]);
    // No anonymous profile is created for a signed-in write (FR-AUTH-03).
    const [profiles] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
    expect(profiles).toHaveLength(0);
  });

  test('hydration returns the account’s state and a session-bound token', async () => {
    const app = newApp();
    const username = newUsername();
    const anonymousId = newAnonymousId();
    const sessionId = cookiesOf(await register(app, anonymousId, { username })).pa_sid;
    await save(app, { anonymousId, sessionId });

    const response = await request(app)
      .get(`/viewer-state?variant=en-us&words=${wordId}`)
      .set('Cookie', [`pa_uid=${anonymousId}`, `pa_sid=${sessionId}`]);

    expect(response.body.words[String(wordId)]).toBe('saved');
    expect(response.body.recordsHistory).toBe(true);
    expect(response.body.csrfToken).toBe(issueCsrfTokenFor(config.csrf.secret, { sessionId }));
  });
});

describe('pages', () => {
  test('/register and /login are uncached and carry a token', async () => {
    const app = newApp();
    for (const path of ['/register', '/login']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.text).toMatch(/name="_csrf" value="[A-Za-z0-9_-]{43}"/);
    }
  });

  test('the landing after sign-in tells the page to adopt the new pa_uid', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sessionId = cookiesOf(await register(app, anonymousId)).pa_sid;
    const landing = await request(app)
      .get('/login?signed-in=1')
      .set('Cookie', [`pa_uid=${anonymousId}`, `pa_sid=${sessionId}`]);
    expect(landing.text).toContain('data-adopt-identity');

    const later = await request(app).get('/login').set('Cookie', [`pa_uid=${anonymousId}`, `pa_sid=${sessionId}`]);
    expect(later.text).not.toContain('data-adopt-identity');
  });
});
