/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Save/tag write and hydration read against the real database (FR-SAVE-01..05,
 * FR-SAVE-08, FR-AUTH-03, B2, B3).
 *
 * These pin invariants rather than the happy path: one event per transition
 * and none for a no-op; append-only history; the derived state equals the
 * latest qualifying event; a read never creates a profile; concurrent
 * duplicates write once; an idempotency key replays.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { generateAnonymousId } from '../../src/lib/ids.js';
import { createInMemoryIdempotencyStore } from '../../src/lib/idempotency-store.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { createSaveStateService } from '../../src/services/save-state.service.js';

let app;
let variantId;
let wordId;
let phonemeIds;
const actors = [];

const key = () => generateAnonymousId().replaceAll('-', '');

/** A fresh anonymous actor whose rows are removed afterwards. */
function newActor() {
  const anonymousId = generateAnonymousId();
  actors.push(anonymousId);
  return anonymousId;
}

async function eventsFor(anonymousId) {
  const [rows] = await getPool().execute(
    'SELECT event_id, target_kind, target_id, event_type, event_value FROM user_activity_events WHERE anonymous_id = ? ORDER BY event_id',
    [anonymousId],
  );
  return rows;
}

async function wordStateFor(anonymousId) {
  const [rows] = await getPool().execute(
    'SELECT state, last_event_id FROM user_word_states WHERE anonymous_id = ? AND word_id = ?',
    [anonymousId, wordId],
  );
  return rows[0];
}

beforeAll(async () => {
  app = createApp();
  const [[variant]] = await getPool().execute("SELECT variant_id FROM language_variants WHERE code = 'en-us'");
  variantId = variant.variant_id;
  const [[word]] = await getPool().execute(
    "SELECT word_id FROM words WHERE variant_id = ? AND normalized_headword = 'cupcake'",
    [variantId],
  );
  wordId = Number(word.word_id);
  const [phonemes] = await getPool().execute(
    'SELECT phoneme_id FROM phonemes WHERE variant_id = ? ORDER BY frequency_rank LIMIT 3',
    [variantId],
  );
  phonemeIds = phonemes.map((row) => Number(row.phoneme_id));
});

afterAll(async () => {
  // Test cleanup runs with the development credential; the application itself
  // has no DELETE path on these tables (FR-SAVE-03, SDD §4.9).
  for (const anonymousId of actors) {
    await getPool().execute('DELETE FROM user_word_states WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM user_phoneme_states WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM user_activity_events WHERE anonymous_id = ?', [anonymousId]);
    await getPool().execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
  }
  await closePool();
  await closeRedis();
});

describe('save/tag write', () => {
  const service = () => createSaveStateService({ idempotencyStore: createInMemoryIdempotencyStore() });

  test('a transition sequence writes one event each and derives the latest state', async () => {
    const anonymousId = newActor();
    const saves = service();
    const act = (action, tag) =>
      saves.applySaveAction({ anonymousId, targetKind: 'word', targetId: wordId, action, tag, idempotencyKey: key() });

    expect((await act('save')).state).toBe('saved');
    expect((await act('tag', 'learning')).state).toBe('learning');
    expect((await act('tag', 'learned')).state).toBe('learned');
    expect((await act('tag', 'learning')).state).toBe('learning');

    const events = await eventsFor(anonymousId);
    expect(events.map((event) => [event.event_type, event.event_value])).toEqual([
      ['save', null],
      ['tag_change', 'learning'],
      ['tag_change', 'learned'],
      ['tag_change', 'learning'],
    ]);
    // FR-SAVE-04 acceptance: save → learning → learned → learning derives `learning`.
    const state = await wordStateFor(anonymousId);
    expect(state.state).toBe('learning');
    expect(Number(state.last_event_id)).toBe(Number(events.at(-1).event_id));
  });

  test('a no-op action writes no event, and tagging an unsaved target is refused', async () => {
    const anonymousId = newActor();
    const saves = service();
    const act = (action, tag) =>
      saves.applySaveAction({ anonymousId, targetKind: 'word', targetId: wordId, action, tag, idempotencyKey: key() });

    expect((await act('unsave')).state).toBe('unsaved');
    await expect(act('tag', 'learned')).rejects.toMatchObject({ status: 409 });
    await act('save');
    expect((await act('save')).state).toBe('saved');
    expect((await act('tag', null)).state).toBe('saved');
    expect((await act('unsave')).state).toBe('unsaved');

    expect((await eventsFor(anonymousId)).map((event) => event.event_type)).toEqual(['save', 'unsave']);
    expect((await wordStateFor(anonymousId)).state).toBe('unsaved');
  });

  test('the first write creates the profile; the unsave leaves the state row in place', async () => {
    const anonymousId = newActor();
    const saves = service();
    await saves.applySaveAction({ anonymousId, targetKind: 'phoneme', targetId: phonemeIds[0], action: 'save', idempotencyKey: key() });
    await saves.applySaveAction({ anonymousId, targetKind: 'phoneme', targetId: phonemeIds[0], action: 'unsave', idempotencyKey: key() });

    const [profiles] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
    expect(profiles).toHaveLength(1);
    const [rows] = await getPool().execute('SELECT state FROM user_phoneme_states WHERE anonymous_id = ?', [anonymousId]);
    expect(rows).toEqual([{ state: 'unsaved' }]);
  });

  test('concurrent duplicate saves write exactly one event', async () => {
    const anonymousId = newActor();
    const saves = service();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        saves.applySaveAction({ anonymousId, targetKind: 'word', targetId: wordId, action: 'save', idempotencyKey: key() }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThan(0);
    expect((await eventsFor(anonymousId)).map((event) => event.event_type)).toEqual(['save']);
    expect((await wordStateFor(anonymousId)).state).toBe('saved');
  });

  test('a repeated idempotency key replays the recorded result without writing', async () => {
    const anonymousId = newActor();
    const saves = service();
    const idempotencyKey = key();
    const first = await saves.applySaveAction({ anonymousId, targetKind: 'word', targetId: wordId, action: 'save', idempotencyKey });
    await saves.applySaveAction({ anonymousId, targetKind: 'word', targetId: wordId, action: 'unsave', idempotencyKey: key() });
    const replay = await saves.applySaveAction({ anonymousId, targetKind: 'word', targetId: wordId, action: 'save', idempotencyKey });

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await eventsFor(anonymousId)).map((event) => event.event_type)).toEqual(['save', 'unsave']);
  });

  test('a missing target is refused and releases its reservation', async () => {
    const anonymousId = newActor();
    const saves = service();
    const idempotencyKey = key();
    const attempt = () =>
      saves.applySaveAction({ anonymousId, targetKind: 'word', targetId: 999999999, action: 'save', idempotencyKey });
    await expect(attempt()).rejects.toMatchObject({ status: 404 });
    await expect(attempt()).rejects.toMatchObject({ status: 404 });
    expect(await eventsFor(anonymousId)).toEqual([]);
  });
});

describe('hydration read (GET /viewer-state)', () => {
  test('a viewer with no profile gets defaults, and the read creates no profile', async () => {
    const anonymousId = newActor();
    const response = await request(app)
      .get(`/viewer-state?variant=en-us&words=${wordId}&phonemes=${phonemeIds.join(',')}`)
      .set('Cookie', `pa_uid=${anonymousId}`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.words).toEqual({ [wordId]: 'unsaved' });
    expect(response.body.learned).toBe(0);
    expect(response.body.total).toBeGreaterThan(0);

    const [profiles] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [anonymousId]);
    expect(profiles).toHaveLength(0);
  });

  test("returns the viewer's states and learned count, and nobody else's", async () => {
    const anonymousId = newActor();
    const saves = createSaveStateService({ idempotencyStore: createInMemoryIdempotencyStore() });
    const act = (targetKind, targetId, action, tag) =>
      saves.applySaveAction({ anonymousId, targetKind, targetId, action, tag, idempotencyKey: key() });
    await act('word', wordId, 'save');
    await act('phoneme', phonemeIds[0], 'save');
    await act('phoneme', phonemeIds[0], 'tag', 'learned');
    await act('phoneme', phonemeIds[1], 'save');
    await act('phoneme', phonemeIds[1], 'tag', 'learning');

    const query = `/viewer-state?variant=en-us&words=${wordId}&phonemes=${phonemeIds.join(',')}`;
    const mine = await request(app).get(query).set('Cookie', `pa_uid=${anonymousId}`);
    expect(mine.body.words).toEqual({ [wordId]: 'saved' });
    expect(mine.body.phonemes).toEqual({
      [phonemeIds[0]]: 'learned',
      [phonemeIds[1]]: 'learning',
      [phonemeIds[2]]: 'unsaved',
    });
    expect(mine.body.learned).toBe(1);

    const someoneElse = await request(app).get(query).set('Cookie', `pa_uid=${newActor()}`);
    expect(someoneElse.body.words).toEqual({ [wordId]: 'unsaved' });
    expect(someoneElse.body.learned).toBe(0);
  });

  test('rejects malformed input as JSON', async () => {
    const response = await request(app).get('/viewer-state?variant=en-us&words=1,abc');
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/json/);
  });
});
