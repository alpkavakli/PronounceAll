/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The save endpoints over HTTP (FR-SAVE-01, FR-SAVE-07, FR-SAVE-08,
 * FR-AUTH-20; SDD v1.1 §6.6).
 *
 * Every rejection is checked for its side effects as well as its status: a
 * refused write must leave no event and no profile behind.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { config } from '../../src/config/index.js';
import { generateAnonymousId } from '../../src/lib/ids.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { issueCsrfToken } from '../../src/services/csrf.service.js';

const ORIGIN = new URL(config.baseUrl).origin;

let app;
let wordId;
const actors = [];

const newActor = () => {
  const id = generateAnonymousId();
  actors.push(id);
  return id;
};
const key = () => generateAnonymousId().replaceAll('-', '');

async function rowsFor(anonymousId) {
  const [events] = await getPool().execute('SELECT event_type FROM user_activity_events WHERE anonymous_id = ?', [anonymousId]);
  const [profiles] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
  return { events: events.map((row) => row.event_type), profile: profiles.length === 1 };
}

// `csrf: null` sends no token; omitted, the correct token for the actor is sent.
const post = (anonymousId, body, { csrf, origin = ORIGIN } = {}) => {
  let call = request(app).post('/save').set('Cookie', `pa_uid=${anonymousId}`).send(body);
  const header = csrf === undefined ? issueCsrfToken(config.csrf.secret, anonymousId) : csrf;
  if (header) call = call.set('X-CSRF-Token', header);
  if (origin !== null) call = call.set('Origin', origin);
  return call;
};

beforeAll(async () => {
  app = createApp();
  const [[word]] = await getPool().execute("SELECT word_id FROM words WHERE normalized_headword = 'cupcake'");
  wordId = Number(word.word_id);
});

afterAll(async () => {
  for (const anonymousId of actors) {
    await getPool().execute('DELETE FROM user_word_states WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM user_phoneme_states WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM user_activity_events WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
  }
  await closePool();
  await closeRedis();
});

describe('POST /save — CSRF (FR-AUTH-20)', () => {
  const body = () => ({ action: 'save', targetKind: 'word', targetId: wordId, idempotencyKey: key() });

  test('without a token: 403, nothing written', async () => {
    const actor = newActor();
    const response = await post(actor, body(), { csrf: null });
    expect(response.status).toBe(403);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(await rowsFor(actor)).toEqual({ events: [], profile: false });
  });

  test("with another identity's token: 403, nothing written", async () => {
    const actor = newActor();
    const response = await post(actor, body(), { csrf: issueCsrfToken(config.csrf.secret, newActor()) });
    expect(response.status).toBe(403);
    expect(await rowsFor(actor)).toEqual({ events: [], profile: false });
  });

  test('from a foreign origin, or with no origin evidence at all: 403', async () => {
    const actor = newActor();
    expect((await post(actor, body(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(actor, body(), { origin: null })).status).toBe(403);
    expect(await rowsFor(actor)).toEqual({ events: [], profile: false });
  });

  test('with no identity cookie: 403', async () => {
    const response = await request(app)
      .post('/save')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', 'anything')
      .send(body());
    expect(response.status).toBe(403);
  });

  test('valid token and origin: the transition is written and returned', async () => {
    const actor = newActor();
    const response = await post(actor, body());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ targetKind: 'word', targetId: wordId, state: 'saved' });
    expect(await rowsFor(actor)).toEqual({ events: ['save'], profile: true });
  });

  test('a repeated idempotency key returns the recorded state and writes once', async () => {
    const actor = newActor();
    const payload = body();
    const first = await post(actor, payload);
    const second = await post(actor, payload);
    expect(first.body.state).toBe('saved');
    expect(second.status).toBe(200);
    expect(second.body.state).toBe('saved');
    expect((await rowsFor(actor)).events).toEqual(['save']);
  });
});

describe('no-JavaScript save (FR-SAVE-07)', () => {
  test('the confirmation page is private, issues the identity, token and key, and creates no profile', async () => {
    const response = await request(app).get(`/save/confirm?kind=word&id=${wordId}&return=%2Fen-us%2Fcupcake`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const cookie = response.headers['set-cookie'].find((value) => value.startsWith('pa_uid='));
    const actor = cookie.slice('pa_uid='.length, cookie.indexOf(';'));
    actors.push(actor);

    expect(response.text).toContain(`name="_csrf" value="${issueCsrfToken(config.csrf.secret, actor)}"`);
    expect(response.text).toMatch(/name="idempotencyKey" value="[A-Za-z0-9_-]{32}"/);
    expect(response.text).toContain('name="returnTo" value="/en-us/cupcake"');
    expect(await rowsFor(actor)).toEqual({ events: [], profile: false });
  });

  test('submitting the form saves and redirects 303 to the return path', async () => {
    const actor = newActor();
    const confirm = await request(app)
      .get(`/save/confirm?kind=word&id=${wordId}&return=%2Fen-us%2Fcupcake`)
      .set('Cookie', `pa_uid=${actor}`);
    const fields = Object.fromEntries(
      [...confirm.text.matchAll(/name="([A-Za-z_]+)" value="([^"]*)"/g)].map(([, name, value]) => [name, value]),
    );
    const field = (name) => fields[name];

    const response = await request(app)
      .post('/save')
      .set('Cookie', `pa_uid=${actor}`)
      .set('Origin', ORIGIN)
      .type('form')
      .send({
        _csrf: field('_csrf'),
        idempotencyKey: field('idempotencyKey'),
        action: field('action'),
        targetKind: field('targetKind'),
        targetId: field('targetId'),
        returnTo: field('returnTo'),
      });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/en-us/cupcake');
    expect(await rowsFor(actor)).toEqual({ events: ['save'], profile: true });

    // The toggle: the next confirmation offers removal.
    const again = await request(app)
      .get(`/save/confirm?kind=word&id=${wordId}&return=%2Fen-us%2Fcupcake`)
      .set('Cookie', `pa_uid=${actor}`);
    expect(again.text).toContain('name="action" value="unsave"');
  });

  test('an off-site return path redirects home, never elsewhere', async () => {
    const actor = newActor();
    const response = await request(app)
      .post('/save')
      .set('Cookie', `pa_uid=${actor}`)
      .set('Origin', ORIGIN)
      .type('form')
      .send({
        _csrf: issueCsrfToken(config.csrf.secret, actor),
        idempotencyKey: key(),
        action: 'save',
        targetKind: 'word',
        targetId: String(wordId),
        returnTo: '//evil.example/steal',
      });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/');
  });

  test('a form submission without a token is refused with the HTML error page', async () => {
    const actor = newActor();
    const response = await request(app)
      .post('/save')
      .set('Cookie', `pa_uid=${actor}`)
      .set('Origin', ORIGIN)
      .type('form')
      .send({ idempotencyKey: key(), action: 'save', targetKind: 'word', targetId: String(wordId), returnTo: '/' });
    expect(response.status).toBe(403);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(await rowsFor(actor)).toEqual({ events: [], profile: false });
  });
});

describe('the cached shell stays viewer-neutral (B2)', () => {
  test('the word page carries the no-JavaScript save link and no token or cookie', async () => {
    const response = await request(app).get('/en-us/cupcake');
    expect(response.status).toBe(200);
    expect(response.text).toContain(`href="/save/confirm?kind=word&amp;id=${wordId}&amp;return=%2Fen-us%2Fcupcake"`);
    expect(response.text).not.toContain('_csrf');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('hydration returns a token for the identity it issues, without creating a profile', async () => {
    const response = await request(app).get(`/viewer-state?variant=en-us&words=${wordId}`);
    const cookie = response.headers['set-cookie'].find((value) => value.startsWith('pa_uid='));
    const actor = cookie.slice('pa_uid='.length, cookie.indexOf(';'));
    actors.push(actor);
    expect(response.body.csrfToken).toBe(issueCsrfToken(config.csrf.secret, actor));
    expect(await rowsFor(actor)).toEqual({ events: [], profile: false });
  });
});
