/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * `POST /listen` (FR-SAVE-09, FR-AUTH-20; SDD v1.1 §6.6).
 *
 * The privacy boundary is the point: a passive visitor's listen is a
 * successful no-op that creates nothing, an eligible actor's is one appended
 * event, and no listen ever moves derived save state.
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
import { createSaveStateService } from '../../src/services/save-state.service.js';

const ORIGIN = new URL(config.baseUrl).origin;

let app;
let wordId;
let phonemeId;
const actors = [];

const newActor = () => {
  const id = generateAnonymousId();
  actors.push(id);
  return id;
};

/** An actor with a progress profile, made the only way one is made: a save. */
async function eligibleActor() {
  const anonymousId = newActor();
  await createSaveStateService({ idempotencyStore: createInMemoryIdempotencyStore() }).applySaveAction({
    anonymousId,
    targetKind: 'word',
    targetId: wordId,
    action: 'save',
    idempotencyKey: generateAnonymousId().replaceAll('-', ''),
  });
  return anonymousId;
}

const listen = (anonymousId, body, { csrf, origin = ORIGIN } = {}) => {
  let call = request(app).post('/listen').set('Cookie', `pa_uid=${anonymousId}`).send(body);
  const header = csrf === undefined ? issueCsrfToken(config.csrf.secret, anonymousId) : csrf;
  if (header) call = call.set('X-CSRF-Token', header);
  if (origin) call = call.set('Origin', origin);
  return call;
};

async function historyOf(anonymousId) {
  const [events] = await getPool().execute(
    'SELECT event_type, target_kind, target_id FROM user_activity_events WHERE anonymous_id = ? ORDER BY event_id',
    [anonymousId],
  );
  const [profiles] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
  return { events: events.map((row) => row.event_type), profile: profiles.length === 1 };
}

beforeAll(async () => {
  app = createApp();
  const [[word]] = await getPool().execute("SELECT word_id FROM words WHERE normalized_headword = 'cupcake'");
  wordId = Number(word.word_id);
  const [[phoneme]] = await getPool().execute('SELECT phoneme_id FROM phonemes ORDER BY frequency_rank LIMIT 1');
  phonemeId = Number(phoneme.phoneme_id);
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

describe('eligibility (FR-SAVE-09)', () => {
  test('a passive visitor: success, no profile, no event', async () => {
    const actor = newActor();
    const response = await listen(actor, { targetKind: 'word', targetId: wordId });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ recorded: false });
    expect(await historyOf(actor)).toEqual({ events: [], profile: false });
  });

  test('an actor with progress: a word listen and a phoneme listen are recorded', async () => {
    const actor = await eligibleActor();
    expect((await listen(actor, { targetKind: 'word', targetId: wordId })).body).toEqual({ recorded: true });
    expect((await listen(actor, { targetKind: 'phoneme', targetId: phonemeId })).body).toEqual({ recorded: true });
    expect((await historyOf(actor)).events).toEqual(['save', 'audio_listen_word', 'audio_listen_phoneme']);
  });

  test('two genuine replays are two events — listens are not deduplicated', async () => {
    const actor = await eligibleActor();
    await listen(actor, { targetKind: 'phoneme', targetId: phonemeId });
    await listen(actor, { targetKind: 'phoneme', targetId: phonemeId });
    expect((await historyOf(actor)).events).toEqual(['save', 'audio_listen_phoneme', 'audio_listen_phoneme']);
  });

  test('a listen never moves derived save state', async () => {
    const actor = await eligibleActor();
    const [[before]] = await getPool().execute(
      'SELECT state, last_event_id FROM user_word_states WHERE anonymous_id = ? AND word_id = ?',
      [actor, wordId],
    );
    await listen(actor, { targetKind: 'word', targetId: wordId });
    const [[after]] = await getPool().execute(
      'SELECT state, last_event_id FROM user_word_states WHERE anonymous_id = ? AND word_id = ?',
      [actor, wordId],
    );
    expect(after).toEqual(before);
  });

  test('hydration reports whether history is recorded', async () => {
    const passive = newActor();
    const eligible = await eligibleActor();
    const query = `/viewer-state?variant=en-us&words=${wordId}`;
    expect((await request(app).get(query).set('Cookie', `pa_uid=${passive}`)).body.recordsHistory).toBe(false);
    expect((await request(app).get(query).set('Cookie', `pa_uid=${eligible}`)).body.recordsHistory).toBe(true);
  });
});

describe('rejections leave nothing behind', () => {
  test('a target that does not exist', async () => {
    const actor = await eligibleActor();
    expect((await listen(actor, { targetKind: 'word', targetId: 999999999 })).status).toBe(404);
    expect((await listen(actor, { targetKind: 'user', targetId: wordId })).status).toBe(400);
    expect((await historyOf(actor)).events).toEqual(['save']);
  });

  test('a missing or foreign token, or a foreign origin', async () => {
    const actor = await eligibleActor();
    expect((await listen(actor, { targetKind: 'word', targetId: wordId }, { csrf: null })).status).toBe(403);
    const foreign = issueCsrfToken(config.csrf.secret, newActor());
    expect((await listen(actor, { targetKind: 'word', targetId: wordId }, { csrf: foreign })).status).toBe(403);
    expect(
      (await listen(actor, { targetKind: 'word', targetId: wordId }, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await historyOf(actor)).events).toEqual(['save']);
  });
});
