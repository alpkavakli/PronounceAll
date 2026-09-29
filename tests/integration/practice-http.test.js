/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Practice over HTTP (FR-PRACTICE-01/03/04/05/06; SDD v1.1 §5.4).
 *
 * The invariants: only a due word ever starts a session; the upcoming list
 * writes nothing; exactly one accepted answer per served turn, even replayed or
 * raced; every answer is one attempt row, one `practice_attempt` event and one
 * SM-2 update; MySQL stands when Redis loses the queue; and a session ends with
 * its counts.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';

// In-memory rate-limit counters, set BEFORE the application is imported (the
// configuration reads the environment at import): the merge test registers an
// account, and the Redis counter for 3 registrations per hour per IP would
// otherwise carry over from earlier runs. See word-request.test.js.
process.env.RATE_LIMIT_STORE = 'memory';

const { createApp } = await import('../../src/app.js');
const { config } = await import('../../src/config/index.js');
const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { createInMemoryIdempotencyStore } = await import('../../src/lib/idempotency-store.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { closeRedis, getRedis } = await import('../../src/lib/redis.js');
const { createPracticeQueueStore } = await import('../../src/lib/practice-queue-store.js');
const { createSessionStore } = await import('../../src/lib/session-store.js');
const { issueCsrfToken, issueCsrfTokenFor } = await import('../../src/services/csrf.service.js');
const { createPracticeService } = await import('../../src/services/practice.service.js');
const { createSaveStateService } = await import('../../src/services/save-state.service.js');
const { createSessionService } = await import('../../src/services/session.service.js');

const ORIGIN = new URL(config.baseUrl).origin;
/** Always 0.99: never defers a learned word, and reinserts 7 ahead (or at the tail). */
const practiceRng = () => 0.99;
const app = createApp({ isBreachedPassword: async () => false, sendMail: async () => {}, googleOidc: null, practiceRng });
const saves = createSaveStateService({ idempotencyStore: createInMemoryIdempotencyStore() });

const actors = [];
const userIds = [];
let wordIds;

const newActor = () => {
  const id = generateAnonymousId();
  actors.push(id);
  return id;
};

async function saveWords(anonymousId, count, { userId } = {}) {
  for (const wordId of wordIds.slice(0, count)) {
    await saves.applySaveAction({
      anonymousId,
      ...(userId ? { userId } : {}),
      targetKind: 'word',
      targetId: wordId,
      action: 'save',
      idempotencyKey: generateAnonymousId().replaceAll('-', ''),
    });
  }
}

const page = (anonymousId, path = '/practice', sessionId) =>
  request(app)
    .get(path)
    .set('Cookie', [`pa_uid=${anonymousId}`, ...(sessionId ? [`pa_sid=${sessionId}`] : [])]);

const turnOf = (html) => {
  const session = html.match(/name="sessionId" value="(\d+)"/);
  const turn = html.match(/name="turnSeq" value="(\d+)"/);
  const word = html.match(/<h1 class="word__headword">([^<]+)<\/h1>/);
  return session ? { sessionId: Number(session[1]), turnSeq: Number(turn[1]), headword: word?.[1] } : null;
};

function answer(anonymousId, { sessionId, turnSeq }, rating, { csrf, pa_sid: authSession } = {}) {
  const token =
    csrf ?? (authSession ? issueCsrfTokenFor(config.csrf.secret, { sessionId: authSession }) : issueCsrfToken(config.csrf.secret, anonymousId));
  const body = new URLSearchParams({ sessionId, turnSeq, rating, ...(token ? { _csrf: token } : {}) });
  return request(app)
    .post('/practice/attempt')
    .set('Cookie', [`pa_uid=${anonymousId}`, ...(authSession ? [`pa_sid=${authSession}`] : [])])
    .set('Origin', ORIGIN)
    .type('form')
    .send(body.toString());
}

const sessionsOf = async (anonymousId) =>
  (await getPool().execute('SELECT * FROM practice_sessions WHERE anonymous_id = ? ORDER BY session_id', [anonymousId]))[0];
const attemptsOf = async (sessionId) =>
  (await getPool().execute('SELECT * FROM practice_attempts WHERE session_id = ? ORDER BY turn_seq', [sessionId]))[0];
const sm2Of = async (anonymousId) =>
  (await getPool().execute('SELECT * FROM sm2_states WHERE anonymous_id = ? ORDER BY word_id', [anonymousId]))[0];
const practiceEventsOf = async (anonymousId) =>
  (
    await getPool().execute(
      "SELECT target_id, event_value FROM user_activity_events WHERE anonymous_id = ? AND event_type = 'practice_attempt' ORDER BY event_id",
      [anonymousId],
    )
  )[0];

/** Answer every served turn with `rating` until the session completes. */
async function finishSession(anonymousId, rating = 'right') {
  for (let guard = 0; guard < 30; guard += 1) {
    const response = await page(anonymousId);
    const turn = turnOf(response.text);
    if (!turn) return response;
    await answer(anonymousId, turn, rating);
  }
  throw new Error('session did not finish');
}

beforeAll(async () => {
  wordIds = (await getPool().query('SELECT word_id FROM words ORDER BY word_id LIMIT 6'))[0].map((row) => Number(row.word_id));
});

/** Static cleanup statements per owner column (no interpolated SQL, NFR-SEC-07). */
const CLEANUP = Object.freeze({
  anonymous: [
    'DELETE a FROM practice_attempts a JOIN practice_sessions s ON s.session_id = a.session_id WHERE s.anonymous_id = ?',
    'DELETE FROM practice_sessions WHERE anonymous_id = ?',
    'DELETE FROM sm2_states WHERE anonymous_id = ?',
    'DELETE FROM user_word_states WHERE anonymous_id = ?',
    'DELETE FROM user_activity_events WHERE anonymous_id = ?',
    'DELETE FROM anonymous_profiles WHERE anonymous_id = ?',
  ],
  user: [
    'DELETE a FROM practice_attempts a JOIN practice_sessions s ON s.session_id = a.session_id WHERE s.user_id = ?',
    'DELETE FROM practice_sessions WHERE user_id = ?',
    'DELETE FROM sm2_states WHERE user_id = ?',
    'DELETE FROM user_word_states WHERE user_id = ?',
    'DELETE FROM user_activity_events WHERE user_id = ?',
    'DELETE FROM identity_bindings WHERE user_id = ?',
    'DELETE FROM consent_records WHERE user_id = ?',
    'DELETE FROM user_accounts WHERE user_id = ?',
    'DELETE FROM users WHERE user_id = ?',
  ],
});

afterAll(async () => {
  const pool = getPool();
  for (const id of userIds) for (const sql of CLEANUP.user) await pool.execute(sql, [id]);
  for (const id of actors) for (const sql of CLEANUP.anonymous) await pool.execute(sql, [id]);
  await closePool();
  await closeRedis();
});

describe('FR-PRACTICE-01 — the three entry states', () => {
  test('nothing saved: the empty state with a link back, and nothing written', async () => {
    const actor = newActor();
    const response = await page(actor);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.text).toContain('You have not saved any words yet.');
    expect(response.text).toContain('href="/"');
    expect(await sessionsOf(actor)).toHaveLength(0);
    const [profiles] = await getPool().execute('SELECT 1 FROM anonymous_profiles WHERE anonymous_id = ?', [actor]);
    expect(profiles).toHaveLength(0);
  });

  test('saved but never practised: due at once, a session starts with the first word and a snapshot', async () => {
    const actor = newActor();
    await saveWords(actor, 2);
    const response = await page(actor);

    const turn = turnOf(response.text);
    expect(turn).toMatchObject({ turnSeq: 0 });
    expect(response.text).toContain('I got it right');
    expect(response.text).toContain('I got it wrong');
    const [session] = await sessionsOf(actor);
    expect(session).toMatchObject({ status: 'active', session_id: turn.sessionId });
    const snapshot = typeof session.initial_queue_snapshot === 'string' ? JSON.parse(session.initial_queue_snapshot) : session.initial_queue_snapshot;
    expect(snapshot.map((entry) => entry.wordId).sort()).toEqual(wordIds.slice(0, 2).sort());
  });

  test('everything scheduled in the future: "no words due", no session; the upcoming list is read-only', async () => {
    const actor = newActor();
    await saveWords(actor, 2);
    await finishSession(actor, 'right');
    const sessionsBefore = await sessionsOf(actor);
    const sm2Before = await sm2Of(actor);

    const none = await page(actor);
    expect(none.text).toContain('You have no words due right now.');
    expect(none.text).toContain('href="/practice?upcoming=1"');

    const list = await page(actor, '/practice?upcoming=1');
    const shown = [...list.text.matchAll(/<time datetime="([^"]+)"/g)].map((match) => match[1]);
    expect(shown).toHaveLength(2);
    expect([...shown].sort()).toEqual(shown);

    expect(await sessionsOf(actor)).toEqual(sessionsBefore);
    expect(await sm2Of(actor)).toEqual(sm2Before);
  });
});

describe('FR-PRACTICE-03 / 04 — answering a turn', () => {
  test('an answer is one attempt, one practice_attempt event with the quality, one SM-2 row', async () => {
    const actor = newActor();
    await saveWords(actor, 2);
    const turn = turnOf((await page(actor)).text);
    const before = Date.now();

    const response = await answer(actor, turn, 'right');
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/practice');

    const attempts = await attemptsOf(turn.sessionId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ turn_seq: 0, rating: 'right' });
    const events = await practiceEventsOf(actor);
    expect(events).toEqual([{ target_id: attempts[0].word_id, event_value: '5' }]);

    const [sm2] = await sm2Of(actor);
    expect(sm2).toMatchObject({ word_id: attempts[0].word_id, repetition_count: 1, interval_days: 1 });
    expect(Number(sm2.ease_factor)).toBeCloseTo(2.6, 3);
    const due = sm2.next_due_at.getTime();
    expect(due % 1000).toBe(0);
    expect(due - before).toBeGreaterThan(23.9 * 3600 * 1000);
    expect(due - before).toBeLessThan(24.1 * 3600 * 1000);

    // The next word is served.
    expect(turnOf((await page(actor)).text)).toMatchObject({ sessionId: turn.sessionId, turnSeq: 1 });
  });

  test('a wrong answer: quality 2, SM-2 reset, and the word is served again in the same session', async () => {
    const actor = newActor();
    await saveWords(actor, 1);
    const turn = turnOf((await page(actor)).text);
    await answer(actor, turn, 'wrong');

    const again = turnOf((await page(actor)).text);
    expect(again).toMatchObject({ sessionId: turn.sessionId, turnSeq: 1, headword: turn.headword });
    const [sm2] = await sm2Of(actor);
    expect(sm2).toMatchObject({ repetition_count: 0, interval_days: 1 });
    expect(Number(sm2.ease_factor)).toBeCloseTo(2.18, 3);
    expect((await practiceEventsOf(actor)).map((event) => event.event_value)).toEqual(['2']);
    // No attempt is recorded for the re-presented word until it is answered.
    expect(await attemptsOf(turn.sessionId)).toHaveLength(1);
  });

  test('a replayed answer to the same turn is accepted once', async () => {
    const actor = newActor();
    await saveWords(actor, 2);
    const turn = turnOf((await page(actor)).text);
    await answer(actor, turn, 'right');
    await answer(actor, turn, 'wrong');

    expect(await attemptsOf(turn.sessionId)).toHaveLength(1);
    expect(await practiceEventsOf(actor)).toHaveLength(1);
  });

  test('concurrent answers to one turn: exactly one accepted', async () => {
    const actor = newActor();
    await saveWords(actor, 3);
    const turn = turnOf((await page(actor)).text);
    await Promise.all(Array.from({ length: 5 }, (_, index) => answer(actor, turn, index % 2 ? 'right' : 'wrong')));

    expect(await attemptsOf(turn.sessionId)).toHaveLength(1);
    expect(await practiceEventsOf(actor)).toHaveLength(1);
    // One SM-2 update: one row, at most one repetition.
    const rows = await sm2Of(actor);
    expect(rows).toHaveLength(1);
    expect(rows[0].repetition_count).toBeLessThanOrEqual(1);
  });

  test("another visitor's session, or no CSRF token: nothing written", async () => {
    const owner = newActor();
    const stranger = newActor();
    await saveWords(owner, 2);
    const turn = turnOf((await page(owner)).text);

    expect((await answer(stranger, turn, 'right')).status).toBe(303);
    expect((await answer(owner, turn, 'right', { csrf: '' })).status).toBe(403);
    expect(await attemptsOf(turn.sessionId)).toHaveLength(0);
    expect(await practiceEventsOf(stranger)).toHaveLength(0);
  });

  test.each([
    [{ sessionId: 'x', turnSeq: 0, rating: 'right' }],
    [{ sessionId: 1, turnSeq: -1, rating: 'right' }],
    [{ sessionId: 1, turnSeq: 0, rating: 'maybe' }],
  ])('a malformed answer %p is refused with 400', async (body) => {
    const actor = newActor();
    const response = await answer(actor, body, body.rating);
    expect(response.status).toBe(400);
  });

  test('the page never asks for the microphone', async () => {
    const actor = newActor();
    await saveWords(actor, 1);
    const response = await page(actor);
    expect(response.text).not.toMatch(/getUserMedia|microphone|MediaRecorder/i);
    expect(response.headers['permissions-policy']).toContain('microphone=()');
  });
});

describe('FR-PRACTICE-06 — how a session ends', () => {
  test('three due words, all right: completed with end time, 3 attempts, 3 correct, and a summary', async () => {
    const actor = newActor();
    await saveWords(actor, 3);
    let lastAnswer;
    for (let index = 0; index < 3; index += 1) {
      lastAnswer = await answer(actor, turnOf((await page(actor)).text), 'right');
    }
    const [session] = await sessionsOf(actor);
    expect(lastAnswer.headers.location).toBe(`/practice?done=${session.session_id}`);
    expect(session).toMatchObject({ status: 'completed', total_attempts: 3, correct_count: 3 });
    expect(session.ended_at).not.toBeNull();

    const summary = await page(actor, `/practice?done=${session.session_id}`);
    expect(summary.text).toContain('Session complete: 3 of 3 answers right.');
    // Another visitor cannot read it.
    expect((await page(newActor(), `/practice?done=${session.session_id}`)).text).not.toContain('Session complete');
  });

  test('a wrong answer that is later corrected: 4 attempts over 3 words', async () => {
    const actor = newActor();
    await saveWords(actor, 3);
    await answer(actor, turnOf((await page(actor)).text), 'wrong');
    await finishSession(actor, 'right');
    const [session] = await sessionsOf(actor);
    expect(session).toMatchObject({ status: 'completed', total_attempts: 4, correct_count: 3 });
  });

  test('leaving and returning within the idle window resumes the same turn', async () => {
    const actor = newActor();
    await saveWords(actor, 3);
    const first = turnOf((await page(actor)).text);
    await answer(actor, first, 'right');
    const current = turnOf((await page(actor)).text);
    expect(turnOf((await page(actor)).text)).toEqual(current);
    expect(await sessionsOf(actor)).toHaveLength(1);
  });

  test('returning after 60 idle minutes finalises the old session as timed out and starts afresh', async () => {
    const actor = newActor();
    await saveWords(actor, 3);
    const turn = turnOf((await page(actor)).text);
    await answer(actor, turn, 'right');
    await getPool().execute(
      'UPDATE practice_sessions SET last_interaction_at = NOW(3) - INTERVAL 61 MINUTE WHERE session_id = ?',
      [turn.sessionId],
    );

    const fresh = turnOf((await page(actor)).text);
    expect(fresh.sessionId).not.toBe(turn.sessionId);
    const [old] = await sessionsOf(actor);
    expect(old).toMatchObject({ status: 'timed_out', total_attempts: 1, correct_count: 1 });
    expect(old.ended_at).not.toBeNull();
  });

  test('the sweep finalises idle sessions no one returned to', async () => {
    const actor = newActor();
    await saveWords(actor, 2);
    const turn = turnOf((await page(actor)).text);
    await getPool().execute(
      'UPDATE practice_sessions SET last_interaction_at = NOW(3) - INTERVAL 61 MINUTE WHERE session_id = ?',
      [turn.sessionId],
    );

    const sweep = createPracticeService({ queueStore: createPracticeQueueStore(), rng: practiceRng });
    expect(await sweep.sweepIdleSessions()).toBeGreaterThanOrEqual(1);
    const [session] = await sessionsOf(actor);
    expect(session.status).toBe('timed_out');
    expect(await getRedis().exists(`practice:queue:${turn.sessionId}`)).toBe(0);
  });

  test('a lost live queue: committed progress stands, the session is abandoned, the next visit builds a new one', async () => {
    const actor = newActor();
    await saveWords(actor, 3);
    const turn = turnOf((await page(actor)).text);
    await answer(actor, turn, 'right');
    await getRedis().del(`practice:queue:${turn.sessionId}`);

    const next = turnOf((await page(actor)).text);
    expect(next.sessionId).not.toBe(turn.sessionId);
    const [old] = await sessionsOf(actor);
    expect(old).toMatchObject({ status: 'abandoned', total_attempts: 1 });
    // The answered word is scheduled a day out, so the new session holds the other two.
    expect(await sm2Of(actor)).toHaveLength(1);
  });
});

describe('FR-AUTH-18 / SDD §4.6 — SM-2 follows the merge', () => {
  const registerFrom = (anonymousId, username) =>
    request(app)
      .post('/register')
      .set('Cookie', [`pa_uid=${anonymousId}`])
      .set('Origin', ORIGIN)
      .type('form')
      .send(
        new URLSearchParams({
          username,
          password: 'zq-a-long-unbreached-passphrase',
          acknowledgeNoRecovery: 'yes',
          'cf-turnstile-response': 'a-token',
          _csrf: issueCsrfToken(config.csrf.secret, anonymousId),
        }).toString(),
      );
  const loginFrom = (anonymousId, username) =>
    request(app)
      .post('/login')
      .set('Cookie', [`pa_uid=${anonymousId}`])
      .set('Origin', ORIGIN)
      .type('form')
      .send(
        new URLSearchParams({
          identifier: username,
          password: 'zq-a-long-unbreached-passphrase',
          'cf-turnstile-response': 'a-token',
          _csrf: issueCsrfToken(config.csrf.secret, anonymousId),
        }).toString(),
      );
  const accountSm2 = async (username) =>
    (
      await getPool().execute(
        `SELECT m.* FROM sm2_states m JOIN users u ON u.user_id = m.user_id WHERE u.username_lower = ?`,
        [username.toLowerCase()],
      )
    )[0];

  test('the account gets the replay of every bound identity, in time order', async () => {
    const phone = newActor();
    const laptop = newActor();
    await saveWords(phone, 1);
    await saveWords(laptop, 1);

    await answer(phone, turnOf((await page(phone)).text), 'right');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await answer(laptop, turnOf((await page(laptop)).text), 'wrong');

    const username = `zzs${Date.now()}`.slice(0, 20);
    expect((await registerFrom(phone, username)).status).toBe(303);
    const [user] = (await getPool().execute('SELECT user_id FROM users WHERE username_lower = ?', [username.toLowerCase()]))[0];
    userIds.push(Number(user.user_id));

    // Only the phone is bound: the replay of its one right answer.
    let [sm2] = await accountSm2(username);
    expect(sm2).toMatchObject({ word_id: wordIds[0], repetition_count: 1, interval_days: 1 });
    expect(Number(sm2.ease_factor)).toBeCloseTo(2.6, 3);

    // The laptop joins: right (earlier) then wrong (later), replayed in order.
    expect((await loginFrom(laptop, username)).status).toBe(303);
    [sm2] = await accountSm2(username);
    expect(sm2).toMatchObject({ word_id: wordIds[0], repetition_count: 0, interval_days: 1 });
    expect(Number(sm2.ease_factor)).toBeCloseTo(2.28, 3);
    // The event log is untouched: two anonymous practice events, none rewritten.
    expect(await practiceEventsOf(phone)).toHaveLength(1);
    expect(await practiceEventsOf(laptop)).toHaveLength(1);
  });
});

describe('practice when signed in', () => {
  test('sessions, attempts and SM-2 belong to the account', async () => {
    const now = new Date();
    const name = `zzp${Date.now()}`.slice(0, 20);
    const [result] = await getPool().execute(
      'INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [name, name, now, now],
    );
    const userId = Number(result.insertId);
    userIds.push(userId);
    const browser = newActor();
    await saveWords(browser, 1, { userId });
    const authSession = await createSessionService({ store: createSessionStore() }).startSession(userId, 0);

    const turn = turnOf((await page(browser, '/practice', authSession)).text);
    await answer(browser, turn, 'right', { pa_sid: authSession });

    const [sessions] = await getPool().execute('SELECT user_id, anonymous_id FROM practice_sessions WHERE session_id = ?', [
      turn.sessionId,
    ]);
    expect(sessions).toEqual([{ user_id: userId, anonymous_id: null }]);
    const [sm2] = await getPool().execute('SELECT 1 FROM sm2_states WHERE user_id = ?', [userId]);
    expect(sm2).toHaveLength(1);
    await createSessionStore().destroyAllForUser(userId);
  });
});
