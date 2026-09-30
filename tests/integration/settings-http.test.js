/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Settings, Iteration 6 slice 1 (FR-SET-01/03/04/05/06/10, FR-CONSENT-03,
 * FR-OSS-01).
 */

import { afterAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { config } from '../../src/config/index.js';
import { generateAnonymousId } from '../../src/lib/ids.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { createSessionStore } from '../../src/lib/session-store.js';
import { issueCsrfToken, issueCsrfTokenFor } from '../../src/services/csrf.service.js';
import { createSessionService } from '../../src/services/session.service.js';
import { adsConsentGranted } from '../../src/services/settings.service.js';

const ORIGIN = new URL(config.baseUrl).origin;
const app = createApp({ isBreachedPassword: async () => false, sendMail: async () => {}, googleOidc: null });
const actors = [];
const userIds = [];

const newActor = () => {
  const id = generateAnonymousId();
  actors.push(id);
  return id;
};

async function newSignedInUser() {
  const now = new Date();
  const name = `zzs${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`;
  const [result] = await getPool().execute(
    'INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [name, name, now, now],
  );
  const userId = Number(result.insertId);
  userIds.push(userId);
  await getPool().execute(
    "INSERT INTO user_accounts (user_id, provider, password_hash, created_at, updated_at) VALUES (?, 'password', ?, ?, ?)",
    [userId, `$2b$12$${'x'.repeat(53)}`, now, now],
  );
  const sessionId = await createSessionService({ store: createSessionStore() }).startSession(userId, 0);
  return { userId, username: name, sessionId };
}

function saveCookies(anonymousId, fields, { sessionId, csrf } = {}) {
  const token =
    csrf !== undefined ? csrf : sessionId ? issueCsrfTokenFor(config.csrf.secret, { sessionId }) : issueCsrfToken(config.csrf.secret, anonymousId);
  const body = new URLSearchParams({ ...fields, ...(token ? { _csrf: token } : {}) });
  return request(app)
    .post('/settings/cookies')
    .set('Cookie', [`pa_uid=${anonymousId}`, ...(sessionId ? [`pa_sid=${sessionId}`] : [])])
    .set('Origin', ORIGIN)
    .type('form')
    .send(body.toString());
}

const CONSENTS_OF = Object.freeze({
  user: 'SELECT consent_type, consent_value, policy_version FROM consent_records WHERE user_id = ? ORDER BY consent_id',
  anonymous:
    'SELECT consent_type, consent_value, policy_version FROM consent_records WHERE anonymous_id = ? ORDER BY consent_id',
});
const consentsOf = async (kind, value) => (await getPool().execute(CONSENTS_OF[kind], [value]))[0];

afterAll(async () => {
  const pool = getPool();
  for (const id of userIds) {
    await pool.execute('DELETE FROM consent_records WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM user_accounts WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE user_id = ?', [id]);
    await createSessionStore().destroyAllForUser(id);
  }
  for (const id of actors) {
    await pool.execute('DELETE FROM consent_records WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [id]);
  }
  await closePool();
  await closeRedis();
});

describe('FR-SET-01 / FR-SET-10 — the page', () => {
  test('signed out: uncached; account management explained, not silently hidden; cookies and language for all', async () => {
    const response = await request(app).get('/settings').set('Cookie', [`pa_uid=${newActor()}`]);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.text).toContain('is available once you have an account');
    expect(response.text).toContain('href="/register"');
    expect(response.text).not.toContain('action="/logout"');
    // Essential cookies: shown, checked, and not switchable.
    expect(response.text).toMatch(/id="cookie-pa_uid" checked disabled/);
    expect(response.text).toMatch(/id="cookie-pa_sid" checked disabled/);
    // Ads: off by default.
    expect(response.text).toMatch(/id="cookie-ads" name="ads" value="on" aria-describedby/);
    // Language: American English only, preselected, and more are promised.
    expect(response.text.match(/<option /g)).toHaveLength(1);
    expect(response.text).toContain('<option value="en-us" selected>American English</option>');
    expect(response.text).toContain('More languages and accents are planned.');
  });

  test('signed in: the account and a sign-out control (FR-SET-06)', async () => {
    const { username, sessionId } = await newSignedInUser();
    const response = await request(app).get('/settings').set('Cookie', [`pa_uid=${newActor()}`, `pa_sid=${sessionId}`]);
    expect(response.text).toContain(`Signed in as <strong>${username}</strong>`);
    expect(response.text).toContain('action="/logout"');
  });
});

describe('FR-SET-03 / FR-SET-04 / FR-CONSENT-03 — cookie preferences', () => {
  test('turning ads on and off appends granted and revoked records with the policy version', async () => {
    const actor = newActor();
    expect((await saveCookies(actor, { ads: 'on' })).status).toBe(303);
    expect(await adsConsentGranted({ anonymousId: actor })).toBe(true);
    expect((await request(app).get('/settings').set('Cookie', [`pa_uid=${actor}`])).text).toMatch(/id="cookie-ads" name="ads" value="on" checked/);

    await saveCookies(actor, {});
    expect(await adsConsentGranted({ anonymousId: actor })).toBe(false);
    expect(await consentsOf('anonymous', actor)).toEqual([
      { consent_type: 'ads_opt_in', consent_value: 'granted', policy_version: config.privacyPolicyVersion },
      { consent_type: 'ads_opt_in', consent_value: 'revoked', policy_version: config.privacyPolicyVersion },
    ]);
  });

  test('saving without a change writes nothing, and creates no profile for a passive visitor', async () => {
    const actor = newActor();
    expect((await saveCookies(actor, {})).status).toBe(303);
    expect(await consentsOf('anonymous', actor)).toEqual([]);
    const [profiles] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [actor]);
    expect(profiles).toHaveLength(0);

    await saveCookies(actor, { ads: 'on' });
    await saveCookies(actor, { ads: 'on' });
    expect(await consentsOf('anonymous', actor)).toHaveLength(1);
  });

  test.each([{ pa_uid: 'off' }, { pa_sid: '' }, { pa_uid: 'false', ads: 'on' }])(
    'a request that switches off an essential cookie (%p) is refused with 400 and records nothing',
    async (fields) => {
      const actor = newActor();
      expect((await saveCookies(actor, fields)).status).toBe(400);
      expect(await consentsOf('anonymous', actor)).toEqual([]);
    },
  );

  test('signed in, the record belongs to the account', async () => {
    const { userId, sessionId } = await newSignedInUser();
    await saveCookies(newActor(), { ads: 'on' }, { sessionId });
    expect(await consentsOf('user', userId)).toEqual([
      { consent_type: 'ads_opt_in', consent_value: 'granted', policy_version: config.privacyPolicyVersion },
    ]);
  });

  test('without a CSRF token: 403, nothing recorded', async () => {
    const actor = newActor();
    expect((await saveCookies(actor, { ads: 'on' }, { csrf: '' })).status).toBe(403);
    expect(await consentsOf('anonymous', actor)).toEqual([]);
  });
});

describe('FR-OSS-01 — the open-source banner is on every page', () => {
  test.each(['/', '/en-us/cupcake', '/learnIPA', '/settings', '/login', '/practice', '/en-us/zzqnotaword', '/no/such/page'])(
    '%s',
    async (path) => {
      const response = await request(app).get(path);
      expect(response.text).toContain('PronounceAll is open-source and free.');
      expect(response.text).toContain('href="https://github.com/alpkavakli/PronounceAll"');
      expect(response.text).toContain('src="/js/oss-banner.js"');
    },
  );

  test('the cached word shell carries the banner and still no Set-Cookie', async () => {
    const response = await request(app).get('/en-us/cupcake');
    expect(response.headers['cache-control']).toMatch(/public/);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
