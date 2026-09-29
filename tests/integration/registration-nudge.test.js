/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The registration nudge flag on the hydration read (FR-AUTH-17).
 *
 * The flag is the server's half: set for a signed-out visitor whose own
 * anonymous identity has 5 or more saved items — words and phonemes together,
 * by derived state — and never for anyone signed in. Showing and dismissing it
 * is the browser's half (tests/e2e/registration-nudge.spec.js).
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { generateAnonymousId } from '../../src/lib/ids.js';
import { createInMemoryIdempotencyStore } from '../../src/lib/idempotency-store.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { createSaveStateService } from '../../src/services/save-state.service.js';

const app = createApp({ isBreachedPassword: async () => false, sendMail: async () => {}, googleOidc: null });
const saves = createSaveStateService({ idempotencyStore: createInMemoryIdempotencyStore() });
const actors = [];
const userIds = [];
let words;
let phonemes;

const newActor = () => {
  const id = generateAnonymousId();
  actors.push(id);
  return id;
};
const act = (owner, targetKind, targetId, action = 'save') =>
  saves.applySaveAction({ ...owner, targetKind, targetId, action, idempotencyKey: generateAnonymousId().replaceAll('-', '') });
const nudgeFor = async (anonymousId, sessionId) =>
  (
    await request(app)
      .get(`/viewer-state?variant=en-us&words=${words[0]}`)
      .set('Cookie', [`pa_uid=${anonymousId}`, ...(sessionId ? [`pa_sid=${sessionId}`] : [])])
  ).body.registrationNudge;

beforeAll(async () => {
  words = (await getPool().query('SELECT word_id FROM words ORDER BY word_id LIMIT 3'))[0].map((row) => Number(row.word_id));
  phonemes = (await getPool().query('SELECT phoneme_id FROM phonemes ORDER BY phoneme_id LIMIT 3'))[0].map((row) =>
    Number(row.phoneme_id),
  );
});

afterAll(async () => {
  const pool = getPool();
  for (const userId of userIds) {
    await pool.execute('DELETE FROM user_word_states WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM user_phoneme_states WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM user_activity_events WHERE user_id = ?', [userId]);
    await pool.execute('DELETE FROM users WHERE user_id = ?', [userId]);
  }
  for (const id of actors) {
    await pool.execute('DELETE FROM user_word_states WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM user_phoneme_states WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM user_activity_events WHERE anonymous_id = ?', [id]);
    await pool.execute('DELETE FROM anonymous_profiles WHERE anonymous_id = ?', [id]);
  }
  await closePool();
  await closeRedis();
});

describe('FR-AUTH-17 — when to suggest an account', () => {
  test('a visitor with no progress: no nudge', async () => {
    expect(await nudgeFor(newActor())).toBe(false);
  });

  test('the transition from 4 to 5 saved items turns it on — words and phonemes together', async () => {
    const actor = newActor();
    await act({ anonymousId: actor }, 'word', words[0]);
    await act({ anonymousId: actor }, 'word', words[1]);
    await act({ anonymousId: actor }, 'phoneme', phonemes[0]);
    await act({ anonymousId: actor }, 'phoneme', phonemes[1]);
    expect(await nudgeFor(actor)).toBe(false);

    await act({ anonymousId: actor }, 'phoneme', phonemes[2]);
    expect(await nudgeFor(actor)).toBe(true);
  });

  test('tagged items count; unsaved ones do not', async () => {
    const actor = newActor();
    for (const id of words) await act({ anonymousId: actor }, 'word', id);
    await act({ anonymousId: actor }, 'phoneme', phonemes[0]);
    await saves.applySaveAction({
      anonymousId: actor,
      targetKind: 'word',
      targetId: words[0],
      action: 'tag',
      tag: 'learned',
      idempotencyKey: generateAnonymousId().replaceAll('-', ''),
    });
    await act({ anonymousId: actor }, 'phoneme', phonemes[1]);
    expect(await nudgeFor(actor)).toBe(true);

    await act({ anonymousId: actor }, 'phoneme', phonemes[1], 'unsave');
    expect(await nudgeFor(actor)).toBe(false);
  });

  test('never for someone signed in, however much is saved', async () => {
    const now = new Date();
    const [result] = await getPool().execute(
      'INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [`zzn${Date.now()}`.slice(0, 20), `zzn${Date.now()}`.slice(0, 20), now, now],
    );
    const userId = Number(result.insertId);
    userIds.push(userId);
    for (const id of words) await act({ anonymousId: newActor(), userId }, 'word', id);
    for (const id of phonemes) await act({ anonymousId: newActor(), userId }, 'phoneme', id);

    const { createSessionService } = await import('../../src/services/session.service.js');
    const { createSessionStore } = await import('../../src/lib/session-store.js');
    const sessionId = await createSessionService({ store: createSessionStore() }).startSession(userId, 0);

    expect(await nudgeFor(newActor(), sessionId)).toBe(false);
    await createSessionStore().destroyAllForUser(userId);
  });
});
