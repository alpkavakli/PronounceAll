/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * `POST /encounter` (FR-SAVE-10, FR-AUTH-20; SDD v1.1 §3.4, §4.4, §6.6).
 *
 * The invariants, not the happy path: a passive reader leaves nothing behind
 * and gets no profile; one encounter per owner, word and UTC day holds under
 * concurrency because the database enforces it; a repeat never updates or
 * deletes the earlier row; nothing the client sends beyond the word id is
 * stored; and an encounter never moves derived save state.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { config } from '../../src/config/index.js';
import { generateAnonymousId } from '../../src/lib/ids.js';
import { createInMemoryIdempotencyStore } from '../../src/lib/idempotency-store.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { issueCsrfToken } from '../../src/services/csrf.service.js';
import { createEncounterService } from '../../src/services/encounter.service.js';
import { createSaveStateService } from '../../src/services/save-state.service.js';

const ORIGIN = new URL(config.baseUrl).origin;

let app;
let wordId;
let otherWordId;
const actors = [];

const newActor = () => {
  const id = generateAnonymousId();
  actors.push(id);
  return id;
};
const newKey = () => generateAnonymousId().replaceAll('-', '');

/** An actor with a progress profile, made the only way one is made: a save. */
async function eligibleActor() {
  const anonymousId = newActor();
  await createSaveStateService({ idempotencyStore: createInMemoryIdempotencyStore() }).applySaveAction({
    anonymousId,
    targetKind: 'word',
    targetId: otherWordId,
    action: 'save',
    idempotencyKey: newKey(),
  });
  return anonymousId;
}

const encounter = (anonymousId, body, { csrf, origin = ORIGIN } = {}) => {
  let call = request(app).post('/encounter').set('Cookie', `pa_uid=${anonymousId}`).send(body);
  const header = csrf === undefined ? issueCsrfToken(config.csrf.secret, anonymousId) : csrf;
  if (header) call = call.set('X-CSRF-Token', header);
  if (origin) call = call.set('Origin', origin);
  return call;
};

/** @returns {Promise<object[]>} every `word_encounter` row of the actor, all columns */
async function encountersOf(anonymousId) {
  const [rows] = await getPool().execute(
    "SELECT * FROM user_activity_events WHERE anonymous_id = ? AND event_type = 'word_encounter' ORDER BY event_id",
    [anonymousId],
  );
  return rows;
}

async function profileExists(anonymousId) {
  const [rows] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
  return rows.length === 1;
}

beforeAll(async () => {
  app = createApp();
  const [[word]] = await getPool().execute("SELECT word_id FROM words WHERE normalized_headword = 'cupcake'");
  wordId = Number(word.word_id);
  const [[other]] = await getPool().execute(
    "SELECT word_id FROM words WHERE normalized_headword <> 'cupcake' ORDER BY word_id LIMIT 1",
  );
  otherWordId = Number(other.word_id);
});

afterAll(async () => {
  for (const anonymousId of actors) {
    await getPool().execute('DELETE FROM user_word_states WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM user_activity_events WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
  }
  await closePool();
  await closeRedis();
});

describe('who is recorded (FR-SAVE-10)', () => {
  test('a viewer with no progress profile: success, no profile, no event', async () => {
    const actor = newActor();
    const response = await encounter(actor, { wordId, idempotencyKey: newKey() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ recorded: false });
    expect(await encountersOf(actor)).toHaveLength(0);
    expect(await profileExists(actor)).toBe(false);
  });

  test('an actor with a progress profile: one event for the canonical word, null value', async () => {
    const actor = await eligibleActor();
    const response = await encounter(actor, { wordId, idempotencyKey: newKey() });

    expect(response.body).toEqual({ recorded: true });
    const [row] = await encountersOf(actor);
    expect(row).toMatchObject({ target_kind: 'word', target_id: wordId, event_value: null, user_id: null });
  });

  test('neither the hydration read nor the word page writes an encounter', async () => {
    const actor = await eligibleActor();
    await request(app).get(`/viewer-state?variant=en-us&words=${wordId}`).set('Cookie', `pa_uid=${actor}`);
    await request(app).get('/en-us/cupcake').set('Cookie', `pa_uid=${actor}`);

    expect(await encountersOf(actor)).toHaveLength(0);
  });
});

describe('one per owner, word and UTC day', () => {
  test('the same word twice on one day: exactly one row, the first left untouched', async () => {
    const actor = await eligibleActor();
    await encounter(actor, { wordId, idempotencyKey: newKey() });
    const [first] = await encountersOf(actor);

    const repeat = await encounter(actor, { wordId, idempotencyKey: newKey() });

    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual({ recorded: false });
    expect(await encountersOf(actor)).toEqual([first]);
  });

  test('concurrent requests from several tabs still yield one row', async () => {
    const actor = await eligibleActor();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => encounter(actor, { wordId, idempotencyKey: newKey() })),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responses.filter((response) => response.body.recorded)).toHaveLength(1);
    expect(await encountersOf(actor)).toHaveLength(1);
  });

  test('two different words on one day are two rows', async () => {
    const actor = await eligibleActor();
    await encounter(actor, { wordId, idempotencyKey: newKey() });
    await encounter(actor, { wordId: otherWordId, idempotencyKey: newKey() });

    expect((await encountersOf(actor)).map((row) => row.target_id)).toEqual([wordId, otherWordId]);
  });

  test('the day boundary is UTC midnight', async () => {
    const actor = await eligibleActor();
    let now = new Date('2026-09-29T23:59:59.999Z');
    const service = createEncounterService({ idempotencyStore: createInMemoryIdempotencyStore(), clock: () => now });
    const record = () => service.recordEncounter({ anonymousId: actor, wordId, idempotencyKey: newKey() });

    expect((await record()).recorded).toBe(true);
    now = new Date('2026-09-29T00:00:00.000Z');
    expect((await record()).recorded).toBe(false);
    now = new Date('2026-09-30T00:00:00.000Z');
    expect((await record()).recorded).toBe(true);

    expect(await encountersOf(actor)).toHaveLength(2);
  });

  test('the limit is the database’s: a raw duplicate insert is refused', async () => {
    const actor = await eligibleActor();
    await encounter(actor, { wordId, idempotencyKey: newKey() });

    const [[row]] = await getPool().execute(
      "SELECT occurred_at FROM user_activity_events WHERE anonymous_id = ? AND event_type = 'word_encounter'",
      [actor],
    );
    await expect(
      getPool().execute(
        `INSERT INTO user_activity_events (anonymous_id, target_kind, target_id, event_type, occurred_at)
         VALUES (?, 'word', ?, 'word_encounter', ?)`,
        [actor, wordId, row.occurred_at],
      ),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  test('other event types are not constrained by the daily key', async () => {
    const actor = await eligibleActor();
    const listen = () =>
      request(app)
        .post('/listen')
        .set('Cookie', `pa_uid=${actor}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', issueCsrfToken(config.csrf.secret, actor))
        .send({ targetKind: 'word', targetId: wordId });
    await listen();
    await listen();

    const [rows] = await getPool().execute(
      "SELECT encounter_day_key FROM user_activity_events WHERE anonymous_id = ? AND event_type = 'audio_listen_word'",
      [actor],
    );
    expect(rows).toEqual([{ encounter_day_key: null }, { encounter_day_key: null }]);
  });

  test('a replayed idempotency key answers from the reservation', async () => {
    const actor = await eligibleActor();
    const service = createEncounterService({ idempotencyStore: createInMemoryIdempotencyStore() });
    const idempotencyKey = newKey();

    expect(await service.recordEncounter({ anonymousId: actor, wordId, idempotencyKey })).toEqual({
      recorded: true,
      replayed: false,
    });
    expect(await service.recordEncounter({ anonymousId: actor, wordId, idempotencyKey })).toEqual({
      recorded: true,
      replayed: true,
    });
    expect(await encountersOf(actor)).toHaveLength(1);
  });
});

describe('what is stored', () => {
  test('no stored column holds the search string or referrer the client sent', async () => {
    const actor = await eligibleActor();
    await encounter(actor, {
      wordId,
      idempotencyKey: newKey(),
      q: 'zzsecretsearch',
      search: 'zzsecretsearch',
      referrer: 'https://zzsecretreferrer.example',
    });

    const rows = await encountersOf(actor);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/zzsecret/);
  });

  test('an encounter never moves derived save state', async () => {
    const actor = await eligibleActor();
    const stateOf = async () =>
      (
        await getPool().execute('SELECT * FROM user_word_states WHERE anonymous_id = ? ORDER BY word_id', [actor])
      )[0];
    const before = await stateOf();

    await encounter(actor, { wordId: otherWordId, idempotencyKey: newKey() });
    await encounter(actor, { wordId, idempotencyKey: newKey() });

    expect(await stateOf()).toEqual(before);
  });
});

describe('rejections leave nothing behind', () => {
  test('a missing or foreign token, or a foreign origin: 403', async () => {
    const actor = await eligibleActor();
    const body = () => ({ wordId, idempotencyKey: newKey() });

    expect((await encounter(actor, body(), { csrf: null })).status).toBe(403);
    expect((await encounter(actor, body(), { csrf: issueCsrfToken(config.csrf.secret, newActor()) })).status).toBe(403);
    expect((await encounter(actor, body(), { origin: 'https://evil.example' })).status).toBe(403);
    expect(await encountersOf(actor)).toHaveLength(0);
  });

  test('a word that does not exist, or a malformed request', async () => {
    const actor = await eligibleActor();

    expect((await encounter(actor, { wordId: 999999999, idempotencyKey: newKey() })).status).toBe(404);
    expect((await encounter(actor, { wordId: 'cupcake', idempotencyKey: newKey() })).status).toBe(400);
    expect((await encounter(actor, { wordId })).status).toBe(400);
    expect(await encountersOf(actor)).toHaveLength(0);
  });

  test('a rejection is answered as JSON', async () => {
    const response = await encounter(newActor(), { wordId, idempotencyKey: newKey() }, { csrf: null });
    expect(response.headers['content-type']).toMatch(/json/);
  });
});
