/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Google sign-in, Iteration 4 slice 3 (FR-AUTH-04a, FR-AUTH-05, FR-AUTH-06,
 * FR-AUTH-12, FR-AUTH-14, FR-AUTH-16, FR-AUTH-18; SDD v1.1 §5.1, §5.6).
 *
 * Against a fake provider boundary — no request reaches Google. The fake mints
 * ID tokens with the nonce the app itself sent, and records every exchange, so
 * a test can prove that a bad state never reaches the exchange at all.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { inspect } from 'node:util';

import request from 'supertest';

process.env.RATE_LIMIT_STORE = 'memory';

const { createApp } = await import('../../src/app.js');
const { config } = await import('../../src/config/index.js');
const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { logger } = await import('../../src/lib/logger.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { closeRedis, getRedis } = await import('../../src/lib/redis.js');
const { createSessionStore } = await import('../../src/lib/session-store.js');
const { REQUEST_LOG_SERIALIZERS } = await import('../../src/middleware/request-context.js');
const { issueCsrfToken, issueCsrfTokenFor } = await import('../../src/services/csrf.service.js');

const ORIGIN = new URL(config.baseUrl).origin;
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

// ---------------------------------------------------------------------------
// The fake provider
// ---------------------------------------------------------------------------

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (claims) => `${b64({ alg: 'RS256' })}.${b64(claims)}.c2ln`;

/** code → { claims } | { fail: true }. Filled by each test. */
const codes = new Map();
const exchanges = [];

const fakeGoogle = {
  clientId: CLIENT_ID,
  authorizationUrl: ({ state, nonce, codeChallenge, fresh = false }) =>
    `https://accounts.google.test/auth?${new URLSearchParams({ state, nonce, code_challenge: codeChallenge, ...(fresh ? { max_age: '0' } : {}) })}`,
  async exchangeCode({ code, codeVerifier }) {
    exchanges.push({ code, codeVerifier });
    const entry = codes.get(code);
    if (!entry || entry.fail) throw new Error('invalid_grant');
    return { idToken: idToken(entry.claims) };
  },
};

const newApp = () =>
  createApp({ isBreachedPassword: async () => false, sendMail: async () => {}, googleOidc: fakeGoogle });

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const subs = [];
const usernames = [];
const anonymousIds = [];
let wordId;

const newAnonymousId = () => {
  const id = generateAnonymousId();
  anonymousIds.push(id);
  return id;
};
const newSub = () => {
  const sub = `9${Date.now()}${generateAnonymousId().replaceAll('-', '').slice(0, 8)}`;
  subs.push(sub);
  return sub;
};
const newUsername = () => {
  const name = `zzg${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`;
  usernames.push(name.toLowerCase());
  return name;
};
const newEmail = () => `zzg-${generateAnonymousId().slice(0, 13)}@gmail.test`;

const claimsFor = ({ sub, email, nonce, ...overrides }) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub,
  email,
  email_verified: true,
  nonce,
  iat: Math.floor(Date.now() / 1000) - 5,
  exp: Math.floor(Date.now() / 1000) + 3600,
  picture: 'https://lh3.googleusercontent.com/a/photo',
  ...overrides,
});

const cookiesOf = (response) => {
  const jar = {};
  for (const line of [response.headers['set-cookie'] ?? []].flat()) {
    const [pair] = line.split(';');
    const [name, ...rest] = pair.split('=');
    jar[name] = rest.join('=');
  }
  return jar;
};

/** "Continue with Google": the state, nonce and challenge the app sent to Google. */
async function start(app, anonymousId) {
  const response = await request(app).get('/auth/google').set('Cookie', [`pa_uid=${anonymousId}`]);
  expect(response.status).toBe(303);
  const sent = new URL(response.headers.location).searchParams;
  return { state: sent.get('state'), nonce: sent.get('nonce'), codeChallenge: sent.get('code_challenge') };
}

/** Google redirects back with a code for these claims. */
function callback(app, anonymousId, query) {
  return request(app)
    .get(`/auth/google/callback?${new URLSearchParams(query)}`)
    .set('Cookie', [`pa_uid=${anonymousId}`]);
}

/** A whole Google round trip, with `claims` (the nonce is filled in). */
async function roundTrip(app, anonymousId, { sub, email, overrides = {} }) {
  const { state, nonce } = await start(app, anonymousId);
  const code = `code-${generateAnonymousId()}`;
  codes.set(code, { claims: claimsFor({ sub, email, nonce, ...overrides }) });
  return { response: await callback(app, anonymousId, { state, code }), state, code };
}

const pendingNonceIn = (html) => html.match(/name="googlePending" value="([A-Za-z0-9_-]{43})"/)?.[1] ?? null;

function completeRegistration(app, anonymousId, pendingNonce, { username = newUsername(), turnstile = 'a-token' } = {}) {
  const body = new URLSearchParams({
    googlePending: pendingNonce,
    username,
    'cf-turnstile-response': turnstile,
    _csrf: issueCsrfToken(config.csrf.secret, anonymousId),
  });
  return request(app)
    .post('/register')
    .set('Cookie', [`pa_uid=${anonymousId}`])
    .set('Origin', ORIGIN)
    .type('form')
    .send(body.toString());
}

/** A new Google account, registered end to end. */
async function registeredGoogleAccount(app) {
  const sub = newSub();
  const email = newEmail();
  const anonymousId = newAnonymousId();
  const { response } = await roundTrip(app, anonymousId, { sub, email });
  const username = newUsername();
  await completeRegistration(app, anonymousId, pendingNonceIn(response.text), { username });
  return { sub, email, username };
}

async function googleAccount(sub) {
  const [rows] = await getPool().execute(
    `SELECT a.*, u.username, u.session_epoch FROM user_accounts a JOIN users u ON u.user_id = a.user_id WHERE a.google_sub = ?`,
    [sub],
  );
  return rows;
}
const usersWithEmail = async (email) =>
  (await getPool().execute('SELECT user_id FROM user_accounts WHERE email_lower = ?', [email.toLowerCase()]))[0];

function save(app, anonymousId) {
  return request(app)
    .post('/save')
    .set('Cookie', [`pa_uid=${anonymousId}`])
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', issueCsrfToken(config.csrf.secret, anonymousId))
    .send({ action: 'save', targetKind: 'word', targetId: wordId, idempotencyKey: generateAnonymousId().replaceAll('-', '') });
}

beforeAll(async () => {
  const [[word]] = await getPool().execute("SELECT word_id FROM words WHERE normalized_headword = 'cupcake'");
  wordId = Number(word.word_id);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT DISTINCT u.user_id FROM users u LEFT JOIN user_accounts a ON a.user_id = u.user_id
      WHERE u.username_lower IN (?) OR a.google_sub IN (?)`,
    [usernames.length ? usernames : [''], subs.length ? subs : ['']],
  );
  for (const { user_id: userId } of rows) {
    await pool.execute('DELETE FROM user_word_states WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM user_activity_events WHERE user_id = ?', [userId]);
    const [bound] = await pool.execute('SELECT anonymous_id FROM identity_bindings WHERE user_id = ?', [userId]);
    anonymousIds.push(...bound.map((row) => row.anonymous_id));
    await pool.execute('DELETE FROM identity_bindings WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM consent_records WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM user_accounts WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM users WHERE user_id = ?', [userId]);
    await createSessionStore().destroyAllForUser(Number(userId));
  }
  for (const id of anonymousIds) {
    await pool.execute('DELETE FROM user_word_states WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM user_activity_events WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [id]);
  }
  await closePool();
  await closeRedis();
});

// ---------------------------------------------------------------------------

describe('FR-AUTH-04a — a new Google identity', () => {
  test('asks for a username; the completion creates one Google account and signs in', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sub = newSub();
    const email = newEmail();

    const { response } = await roundTrip(app, anonymousId, { sub, email });
    expect(response.status).toBe(200);
    expect(response.text).toContain('Choose a username');
    expect(cookiesOf(response).pa_sid).toBeUndefined();
    // The page carries only the nonce, never the identity.
    expect(response.text).not.toContain(sub);
    const pendingNonce = pendingNonceIn(response.text);
    expect(pendingNonce).toBeTruthy();
    expect(await googleAccount(sub)).toHaveLength(0);

    const username = newUsername();
    const done = await completeRegistration(app, anonymousId, pendingNonce, { username });
    expect(done.status).toBe(303);
    expect(done.headers.location).toBe('/login');
    expect(cookiesOf(done).pa_sid).toBeTruthy();

    const [account] = await googleAccount(sub);
    expect(account).toMatchObject({
      provider: 'google',
      username,
      email,
      email_lower: email.toLowerCase(),
      password_hash: null,
      profile_picture_url: 'https://lh3.googleusercontent.com/a/photo',
    });
    expect(account.email_verified_at).not.toBeNull();
    const [consents] = await getPool().execute('SELECT 1 FROM consent_records WHERE user_id = ?', [account.user_id]);
    expect(consents).toHaveLength(0);
  });

  test('the completion needs Turnstile, CSRF and a free username; the nonce survives a fixable error', async () => {
    // The register limit is 3/h per IP and these calls share one IP, so they
    // are spread over app instances; the pending state itself lives in Redis.
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sub = newSub();
    const taken = (await registeredGoogleAccount(newApp())).username;
    const { response } = await roundTrip(app, anonymousId, { sub, email: newEmail() });
    const pendingNonce = pendingNonceIn(response.text);

    expect((await completeRegistration(app, anonymousId, pendingNonce, { turnstile: '' })).status).toBe(400);
    const clash = await completeRegistration(app, anonymousId, pendingNonce, { username: taken.toUpperCase() });
    expect(clash.status).toBe(409);
    expect(pendingNonceIn(clash.text)).toBe(pendingNonce);
    const noCsrf = await request(newApp())
      .post('/register')
      .set('Cookie', [`pa_uid=${anonymousId}`])
      .set('Origin', ORIGIN)
      .type('form')
      .send(new URLSearchParams({ googlePending: pendingNonce, username: newUsername(), 'cf-turnstile-response': 'a-token' }).toString());
    expect(noCsrf.status).toBe(403);
    expect(await googleAccount(sub)).toHaveLength(0);

    expect((await completeRegistration(newApp(), anonymousId, pendingNonce)).status).toBe(303);
    expect(await googleAccount(sub)).toHaveLength(1);
  });

  test('the pending registration belongs to the browser that started it, and works once', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sub = newSub();
    const { response } = await roundTrip(app, anonymousId, { sub, email: newEmail() });
    const pendingNonce = pendingNonceIn(response.text);

    const stolen = await completeRegistration(app, newAnonymousId(), pendingNonce);
    expect(stolen.status).toBe(400);
    expect(stolen.text).toContain("We couldn't sign you in with Google");
    expect(await googleAccount(sub)).toHaveLength(0);

    expect((await completeRegistration(app, anonymousId, pendingNonce)).status).toBe(303);
    expect((await completeRegistration(app, anonymousId, pendingNonce)).status).toBe(400);
    expect(await googleAccount(sub)).toHaveLength(1);
  });

  test('simultaneous completions of one pending registration create one account', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sub = newSub();
    const { response } = await roundTrip(app, anonymousId, { sub, email: newEmail() });
    const pendingNonce = pendingNonceIn(response.text);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => completeRegistration(app, anonymousId, pendingNonce)),
    );
    expect(results.filter((result) => result.status === 303)).toHaveLength(1);
    expect(await googleAccount(sub)).toHaveLength(1);
  });
});

describe('FR-AUTH-04a — a returning Google identity', () => {
  test('signs in directly, with no new account', async () => {
    const app = newApp();
    const { sub, email, username } = await registeredGoogleAccount(app);

    const { response } = await roundTrip(app, newAnonymousId(), { sub, email });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/login');
    const sessionId = cookiesOf(response).pa_sid;
    expect(sessionId).toBeTruthy();
    expect(await googleAccount(sub)).toHaveLength(1);

    const page = await request(app).get('/login').set('Cookie', [`pa_uid=${newAnonymousId()}`, `pa_sid=${sessionId}`]);
    expect(page.text).toContain(`Signed in as <strong>${username}</strong>`);
  });

  test('the subject is the identity: a changed email still reaches the same account', async () => {
    const app = newApp();
    const { sub } = await registeredGoogleAccount(app);
    const [before] = await googleAccount(sub);

    const { response } = await roundTrip(app, newAnonymousId(), { sub, email: newEmail() });
    expect(response.status).toBe(303);
    const after = await googleAccount(sub);
    expect(after).toHaveLength(1);
    expect(after[0].user_id).toBe(before.user_id);
  });

  test('the email is not the identity: a different subject with that email gets no account', async () => {
    const app = newApp();
    const { email } = await registeredGoogleAccount(app);
    const stranger = newSub();

    const { response } = await roundTrip(app, newAnonymousId(), { sub: stranger, email: email.toUpperCase() });
    expect(response.status).toBe(400);
    expect(cookiesOf(response).pa_sid).toBeUndefined();
    expect(await googleAccount(stranger)).toHaveLength(0);
    expect(await usersWithEmail(email)).toHaveLength(1);
  });

  test('works with the same Redis session rules: moving session_epoch ends it', async () => {
    const app = newApp();
    const { sub, email } = await registeredGoogleAccount(app);
    const sessionId = cookiesOf((await roundTrip(app, newAnonymousId(), { sub, email })).response).pa_sid;
    const [account] = await googleAccount(sub);

    await getPool().execute('UPDATE users SET session_epoch = session_epoch + 1 WHERE user_id = ?', [account.user_id]);
    const page = await request(app).get('/login').set('Cookie', [`pa_uid=${newAnonymousId()}`, `pa_sid=${sessionId}`]);
    expect(page.text).not.toContain('Signed in as');
  });
});

describe('SDD §5.6 — an email that already belongs to an account', () => {
  test('a password account holds the email: the generic refusal, no second account, no linking', async () => {
    const app = newApp();
    const email = newEmail();
    const username = newUsername();
    const register = await request(app)
      .post('/register')
      .set('Cookie', [`pa_uid=${newAnonymousId()}`])
      .set('Origin', ORIGIN)
      .type('form')
      .send(
        new URLSearchParams({
          username,
          email,
          password: 'zq-a-long-unbreached-passphrase',
          'cf-turnstile-response': 'a-token',
          _csrf: issueCsrfToken(config.csrf.secret, anonymousIds.at(-1)),
        }).toString(),
      );
    expect(register.status).toBe(200);
    const sub = newSub();

    const { response } = await roundTrip(app, newAnonymousId(), { sub, email });
    expect(response.status).toBe(400);
    expect(response.text).toContain("We couldn't sign you in with Google");
    expect(response.text).not.toContain(email);
    expect(pendingNonceIn(response.text)).toBeNull();
    expect(await googleAccount(sub)).toHaveLength(0);
    const holders = await usersWithEmail(email);
    expect(holders).toHaveLength(1);
    const [google] = await getPool().execute(
      "SELECT 1 FROM user_accounts WHERE user_id = ? AND provider = 'google'",
      [holders[0].user_id],
    );
    expect(google).toHaveLength(0);
  });
});

describe('FR-AUTH-18 / SDD §5.1 — the same auth transition as a password sign-in', () => {
  test('a returning Google sign-in merges anonymous progress and rotates pa_uid in its own response', async () => {
    const app = newApp();
    const { sub, email } = await registeredGoogleAccount(app);
    const device = newAnonymousId();
    await save(app, device);

    const { response } = await roundTrip(app, device, { sub, email });
    const issued = cookiesOf(response);
    expect(issued.pa_sid).toBeTruthy();
    expect(issued.pa_uid).toBeTruthy();
    expect(issued.pa_uid).not.toBe(device);
    anonymousIds.push(issued.pa_uid);

    const [account] = await googleAccount(sub);
    const [links] = await getPool().execute('SELECT user_id FROM identity_bindings WHERE anonymous_id = ?', [device]);
    expect(links).toEqual([{ user_id: account.user_id }]);
    const [states] = await getPool().execute('SELECT state FROM user_word_states WHERE user_id = ? AND word_id = ?', [
      account.user_id,
      wordId,
    ]);
    expect(states).toEqual([{ state: 'saved' }]);
  });

  test('a new Google registration merges too', async () => {
    const app = newApp();
    const device = newAnonymousId();
    await save(app, device);
    const sub = newSub();
    const { response } = await roundTrip(app, device, { sub, email: newEmail() });
    const done = await completeRegistration(app, device, pendingNonceIn(response.text));

    expect(cookiesOf(done).pa_uid).not.toBe(device);
    anonymousIds.push(cookiesOf(done).pa_uid);
    const [account] = await googleAccount(sub);
    const [links] = await getPool().execute('SELECT user_id FROM identity_bindings WHERE anonymous_id = ?', [device]);
    expect(links).toEqual([{ user_id: account.user_id }]);
  });

  test('after sign-out, new work belongs to the fresh anonymous identity', async () => {
    const app = newApp();
    const { sub, email } = await registeredGoogleAccount(app);
    const device = newAnonymousId();
    await save(app, device);
    const issued = cookiesOf((await roundTrip(app, device, { sub, email })).response);
    const [account] = await googleAccount(sub);

    await request(app)
      .post('/logout')
      .set('Cookie', [`pa_uid=${issued.pa_uid}`, `pa_sid=${issued.pa_sid}`])
      .set('Origin', ORIGIN)
      .type('form')
      .send(`_csrf=${issueCsrfTokenFor(config.csrf.secret, { sessionId: issued.pa_sid })}`);
    await save(app, issued.pa_uid);

    const [anonymous] = await getPool().execute(
      "SELECT COUNT(*) AS n FROM user_activity_events WHERE anonymous_id = ? AND event_type = 'save'",
      [issued.pa_uid],
    );
    const [owned] = await getPool().execute(
      "SELECT COUNT(*) AS n FROM user_activity_events WHERE user_id = ? AND event_type = 'save'",
      [account.user_id],
    );
    expect(Number(anonymous[0].n)).toBe(1);
    expect(Number(owned[0].n)).toBe(0);
  });
});

describe('the OAuth state', () => {
  const expectNothingHappened = async (response, sub) => {
    expect(response.status).toBe(400);
    expect(cookiesOf(response).pa_sid).toBeUndefined();
    expect(pendingNonceIn(response.text)).toBeNull();
    expect(await googleAccount(sub)).toHaveLength(0);
  };

  test('is its own CSPRNG secret, never the CSRF token, and the challenge is S256 of a hidden verifier', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const { state, nonce, codeChallenge } = await start(app, anonymousId);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toBe(issueCsrfToken(config.csrf.secret, anonymousId));
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Stored under the state's hash, never the state itself, with a short life.
    expect(await getRedis().exists(`oauth-state:google:${state}`)).toBe(0);
  });

  test.each([
    ['missing', () => ({ code: 'c' })],
    ['unknown', () => ({ state: 'A'.repeat(43), code: 'c' })],
    ['malformed', () => ({ state: 'not-a-state', code: 'c' })],
  ])('a %s state fails before any exchange', async (_label, query) => {
    const before = exchanges.length;
    const response = await callback(newApp(), newAnonymousId(), query());
    expect(response.status).toBe(400);
    expect(exchanges.length).toBe(before);
  });

  test('a reused state fails, and the second callback reaches no exchange', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sub = newSub();
    const { state, code } = await roundTrip(app, anonymousId, { sub, email: newEmail() });
    const before = exchanges.length;
    await expectNothingHappened(await callback(app, anonymousId, { state, code }), newSub());
    expect(exchanges.length).toBe(before);
  });

  test('an expired state fails', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const { state, nonce } = await start(app, anonymousId);
    // Expire it the way Redis would.
    const { createHash } = await import('node:crypto');
    await getRedis().del(`oauth-state:google:${createHash('sha256').update(state).digest('hex')}`);
    const sub = newSub();
    const code = `code-${generateAnonymousId()}`;
    codes.set(code, { claims: claimsFor({ sub, email: newEmail(), nonce }) });

    await expectNothingHappened(await callback(app, anonymousId, { state, code }), sub);
  });

  test('a state from another browser fails (login CSRF), and is spent', async () => {
    const app = newApp();
    const victim = newAnonymousId();
    const attacker = newAnonymousId();
    const sub = newSub();
    const { state, nonce } = await start(app, attacker);
    const code = `code-${generateAnonymousId()}`;
    codes.set(code, { claims: claimsFor({ sub, email: newEmail(), nonce }) });

    await expectNothingHappened(await callback(app, victim, { state, code }), sub);
    await expectNothingHappened(await callback(app, attacker, { state, code }), sub);
  });

  test('simultaneous callbacks with one state: at most one proceeds, one identity at most', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sub = newSub();
    const { state, nonce } = await start(app, anonymousId);
    const code = `code-${generateAnonymousId()}`;
    codes.set(code, { claims: claimsFor({ sub, email: newEmail(), nonce }) });

    const results = await Promise.all(Array.from({ length: 5 }, () => callback(app, anonymousId, { state, code })));
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 400)).toHaveLength(4);
  });
});

describe('provider failures fail safely', () => {
  test('Google answers with an error (the person refused): nothing is exchanged or created', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const { state } = await start(app, anonymousId);
    const before = exchanges.length;

    const response = await callback(app, anonymousId, { state, error: 'access_denied' });
    expect(response.status).toBe(400);
    expect(response.text).toContain('Google sign-in was not completed');
    expect(response.text).not.toContain('access_denied');
    expect(exchanges.length).toBe(before);
  });

  test('a failed code exchange: nothing created, no internals shown', async () => {
    const app = newApp();
    const anonymousId = newAnonymousId();
    const { state } = await start(app, anonymousId);
    const code = `code-${generateAnonymousId()}`;
    codes.set(code, { fail: true });

    const response = await callback(app, anonymousId, { state, code });
    expect(response.status).toBe(400);
    expect(response.text).not.toMatch(/invalid_grant|token endpoint/);
  });

  test.each([
    ['a foreign issuer', { iss: 'https://evil.example' }],
    ['another audience', { aud: 'someone-else' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 10 }],
    ['a replayed nonce', { nonce: 'from-another-flow' }],
    ['an email Google has not verified', { email_verified: false }],
  ])('%s is refused and creates nothing', async (_label, overrides) => {
    const app = newApp();
    const sub = newSub();
    const { response } = await roundTrip(app, newAnonymousId(), { sub, email: newEmail(), overrides });
    expect(response.status).toBe(400);
    expect(pendingNonceIn(response.text)).toBeNull();
    expect(await googleAccount(sub)).toHaveLength(0);
  });
});

describe('nothing secret reaches a log or a page', () => {
  /**
   * pino applies the configured serialisers when it writes; a spy on the logger
   * sees the raw request and response objects first. Apply the same serialisers
   * here, so the assertion is about what is actually written.
   */
  const asWritten = (arg) => {
    if (!arg || typeof arg !== 'object') return arg;
    const shaped = { ...arg };
    if (shaped.res) shaped.res = REQUEST_LOG_SERIALIZERS.res(shaped.res);
    if (shaped.req) {
      const raw = shaped.req;
      shaped.req = REQUEST_LOG_SERIALIZERS.req({ id: raw.id, method: raw.method, url: raw.originalUrl ?? raw.url });
    }
    return shaped;
  };

  test('no code, state, nonce, token or verifier in any log call; the callback URL is logged as its path', async () => {
    const calls = [];
    for (const level of ['info', 'warn', 'error', 'debug']) {
      jest.spyOn(logger, level).mockImplementation((...args) => void calls.push(inspect(args.map(asWritten), { depth: 8 })));
    }
    const app = newApp();
    const anonymousId = newAnonymousId();
    const sub = newSub();
    const { state, nonce } = await start(app, anonymousId);
    const code = `code-${generateAnonymousId()}`;
    const token = claimsFor({ sub, email: newEmail(), nonce, iss: 'https://evil.example' });
    codes.set(code, { claims: token });
    await callback(app, anonymousId, { state, code });

    const verifier = exchanges.at(-1).codeVerifier;
    const logged = calls.join('\n');
    expect(logged).toContain('Google sign-in refused');
    for (const secret of [state, nonce, code, verifier, idToken(token), 'the-client-secret']) {
      expect(logged).not.toContain(secret);
    }
    const line = REQUEST_LOG_SERIALIZERS.req({ id: 'c', method: 'GET', url: `/auth/google/callback?state=${state}&code=${code}` });
    expect(line.url).toBe('/auth/google/callback');
  });

  test('the callback response keeps its URL out of any Referer', async () => {
    const response = await callback(newApp(), newAnonymousId(), { state: 'A'.repeat(43), code: 'c' });
    expect(response.headers['referrer-policy']).toBe('strict-origin');
  });
});

describe('pages', () => {
  test('/login and /register offer "Continue with Google" as a plain link — no Google request on page load', async () => {
    const app = newApp();
    for (const path of ['/login', '/register']) {
      const page = await request(app).get(path);
      expect(page.text).toContain('href="/auth/google"');
      expect(page.text).not.toMatch(/accounts\.google|googleapis|gstatic/);
    }
  });

  test('unconfigured, the path is not offered at all', async () => {
    const app = createApp({ isBreachedPassword: async () => false, sendMail: async () => {}, googleOidc: null });
    expect((await request(app).get('/auth/google')).status).toBe(404);
    expect((await request(app).get('/auth/google/callback?state=x&code=y')).status).toBe(404);
    expect((await request(app).get('/login')).text).not.toContain('/auth/google');
  });
});

describe('FR-SET-07/09 — deleting and restoring a Google account', () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const reauthNonceIn = (html) => html.match(/name="reauth" value="([A-Za-z0-9_-]{43})"/)?.[1] ?? null;
  const userRow = async (sub) => {
    const [account] = await googleAccount(sub);
    return (await getPool().execute('SELECT * FROM users WHERE user_id = ?', [account.user_id]))[0][0];
  };

  /** A registered Google account, signed in on a browser. */
  async function signedInGoogleAccount(app) {
    const account = await registeredGoogleAccount(app);
    const anonymousId = newAnonymousId();
    const { response } = await roundTrip(app, anonymousId, account);
    return { ...account, anonymousId: cookiesOf(response).pa_uid ?? anonymousId, sessionId: cookiesOf(response).pa_sid };
  }

  /** "Confirm with Google", then Google answers for `sub` with these claim overrides. */
  async function reauth(app, { anonymousId, sessionId, sub, email }, overrides = {}, { arriveAs = sessionId } = {}) {
    const begun = await request(app)
      .get('/settings/delete/google')
      .set('Cookie', [`pa_uid=${anonymousId}`, `pa_sid=${sessionId}`]);
    expect(begun.status).toBe(303);
    const sent = new URL(begun.headers.location).searchParams;
    expect(sent.get('max_age')).toBe('0');
    const code = `code-${generateAnonymousId()}`;
    codes.set(code, { claims: claimsFor({ sub, email, nonce: sent.get('nonce'), auth_time: nowSeconds() - 5, ...overrides }) });
    return request(app)
      .get(`/auth/google/callback?${new URLSearchParams({ state: sent.get('state'), code })}`)
      .set('Cookie', [`pa_uid=${anonymousId}`, ...(arriveAs ? [`pa_sid=${arriveAs}`] : [])]);
  }

  test('step 1 offers Google, not a password', async () => {
    const app = newApp();
    const viewer = await signedInGoogleAccount(app);
    const page = await request(app)
      .get('/settings/delete')
      .set('Cookie', [`pa_uid=${viewer.anonymousId}`, `pa_sid=${viewer.sessionId}`]);
    expect(page.text).toContain('href="/settings/delete/google"');
    expect(page.text).not.toContain('action="/settings/delete/reauth"');
  });

  test('a fresh Google sign-in opens step 2; soft delete; signing in with Google again restores', async () => {
    const app = newApp();
    const viewer = await signedInGoogleAccount(app);

    const step2 = await reauth(app, viewer);
    expect(step2.status).toBe(200);
    const nonce = reauthNonceIn(step2.text);
    expect(nonce).not.toBeNull();
    expect(cookiesOf(step2).pa_sid).toBeUndefined();

    const deleted = await request(app)
      .post('/settings/delete')
      .set('Cookie', [`pa_uid=${viewer.anonymousId}`, `pa_sid=${viewer.sessionId}`])
      .set('Origin', ORIGIN)
      .type('form')
      .send(
        new URLSearchParams({
          reauth: nonce,
          option: 'soft',
          _csrf: issueCsrfTokenFor(config.csrf.secret, { sessionId: viewer.sessionId }),
        }).toString(),
      );
    expect(deleted.status).toBe(200);
    expect((await userRow(viewer.sub)).deletion_state).toBe('soft_deleted');

    const { response } = await roundTrip(app, newAnonymousId(), viewer);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/login?restored=1');
    expect((await userRow(viewer.sub)).deletion_state).toBe('none');
  });

  test('a Google sign-in that is not fresh does not count', async () => {
    const app = newApp();
    const viewer = await signedInGoogleAccount(app);
    for (const overrides of [{ auth_time: nowSeconds() - 3600 }, { auth_time: undefined }]) {
      const response = await reauth(app, viewer, overrides);
      expect(response.status).toBe(400);
      expect(reauthNonceIn(response.text)).toBeNull();
    }
    expect((await userRow(viewer.sub)).deletion_state).toBe('none');
  });

  test('another Google account, or another session, does not count', async () => {
    const app = newApp();
    const viewer = await signedInGoogleAccount(app);
    const other = await registeredGoogleAccount(app);

    const wrongAccount = await reauth(app, viewer, { sub: other.sub, email: other.email });
    expect(wrongAccount.status).toBe(400);
    expect(reauthNonceIn(wrongAccount.text)).toBeNull();

    // The same account signed in elsewhere: a second session, not the one that began.
    const elsewhere = cookiesOf((await roundTrip(app, newAnonymousId(), viewer)).response).pa_sid;
    for (const arriveAs of [elsewhere, null]) {
      const response = await reauth(app, viewer, {}, { arriveAs });
      expect(response.status).toBe(400);
      expect(reauthNonceIn(response.text)).toBeNull();
    }
    expect((await userRow(viewer.sub)).deletion_state).toBe('none');
  });

  test('a hard-deleted Google account cannot sign in', async () => {
    const app = newApp();
    const { sub, email } = await registeredGoogleAccount(app);
    const [account] = await googleAccount(sub);
    await getPool().execute(
      "UPDATE users SET deletion_state = 'hard_delete_scheduled', hard_delete_scheduled_at = NOW(3) + INTERVAL 1 DAY WHERE user_id = ?",
      [account.user_id],
    );
    const { response } = await roundTrip(app, newAnonymousId(), { sub, email });
    expect(response.status).toBe(400);
    expect(cookiesOf(response).pa_sid).toBeUndefined();
    await getPool().execute("UPDATE users SET deletion_state = 'none', hard_delete_scheduled_at = NULL WHERE user_id = ?", [
      account.user_id,
    ]);
  });
});
