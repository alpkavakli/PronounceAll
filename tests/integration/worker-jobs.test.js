/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The worker tier, Iteration 7 slice 2 (Threat Model F4; SDD v1.1 §4.9, §6.5,
 * C6; NFR-PRIV-02): the dormancy prune, the routine expiry pruning, and the
 * BullMQ boundary — schedules, processing, and the exhausted-retry alert —
 * against the real MySQL and Redis.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { createJobConnection, startJobWorker, QUEUES } = await import('../../src/lib/job-queue.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { createPracticeQueueStore } = await import('../../src/lib/practice-queue-store.js');
const { closeRedis, getRedis } = await import('../../src/lib/redis.js');
const { createSessionStore } = await import('../../src/lib/session-store.js');
const { insertConsent } = await import('../../src/repositories/consent.repository.js');
const { insertLinkBinding } = await import('../../src/repositories/identity-bindings.repository.js');
const { insertAttempt, insertSession, upsertSm2State } = await import('../../src/repositories/practice.repository.js');
const { insertActivityEvent, touchAnonymousProfile, upsertTargetState } = await import(
  '../../src/repositories/progress.repository.js'
);
const { recordWordRequest } = await import('../../src/repositories/word-requests.repository.js');
const { erasureJobs } = await import('../../src/jobs/erasure.jobs.js');
const { maintenanceJobs } = await import('../../src/jobs/maintenance.jobs.js');
const { appJobs } = await import('../../src/jobs/app.jobs.js');
const { createDormancyService, dormancyCutoff } = await import('../../src/services/anonymous-dormancy.service.js');
const { createRetentionService } = await import('../../src/services/retention.service.js');
const { createSessionService } = await import('../../src/services/session.service.js');

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const queueStore = createPracticeQueueStore();
const userIds = [];
const requestWords = [];
let wordId;
let phonemeId;
let variantId;

beforeAll(async () => {
  wordId = Number((await getPool().query('SELECT word_id FROM words ORDER BY word_id LIMIT 1'))[0][0].word_id);
  phonemeId = Number((await getPool().query('SELECT phoneme_id FROM phonemes ORDER BY phoneme_id LIMIT 1'))[0][0].phoneme_id);
  variantId = Number((await getPool().query('SELECT variant_id FROM language_variants ORDER BY variant_id LIMIT 1'))[0][0].variant_id);
});

afterAll(async () => {
  const pool = getPool();
  for (const id of userIds) {
    await pool.execute('DELETE FROM identity_bindings WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM auth_tokens WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM user_accounts WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE user_id = ?', [id]);
  }
  for (const word of requestWords) {
    await pool.execute('DELETE FROM word_requests WHERE variant_id = ? AND normalized_word = ?', [variantId, word]);
  }
  await closePool();
  await closeRedis();
});

async function newUser() {
  const now = new Date();
  const name = `zzw${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`;
  const [result] = await getPool().execute(
    'INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [name, name, now, now],
  );
  userIds.push(Number(result.insertId));
  return Number(result.insertId);
}

/** An anonymous identity with something in every table the prune must empty, last seen `lastSeen`. */
async function populatedIdentity(lastSeen) {
  const anonymousId = generateAnonymousId();
  const owner = { anonymousId };
  const now = new Date();
  await touchAnonymousProfile(anonymousId, now);
  for (const [targetKind, targetId] of [['word', wordId], ['phoneme', phonemeId]]) {
    const eventId = await insertActivityEvent({ owner, targetKind, targetId, eventType: 'save', eventValue: null, occurredAt: now });
    await upsertTargetState({ owner, targetKind, targetId, state: 'saved', lastEventId: eventId, updatedAt: now });
  }
  await upsertSm2State({ owner, wordId, state: { repetitionCount: 1, easeFactor: 2.5, intervalDays: 1 }, nextDueAt: now, reviewedAt: now });
  const practiceSessionId = await insertSession(owner, now, [{ wordId, tag: 'saved' }]);
  await insertAttempt({ sessionId: practiceSessionId, wordId, turnSeq: 1, rating: 'right', now });
  await queueStore.save(practiceSessionId, { turns: [] });
  await insertConsent({ owner, consentType: 'ads_opt_in', consentValue: 'granted', policyVersion: 'test', now });
  const word = `zzw${randomInt(0, 2 ** 31)}`;
  requestWords.push(word);
  await recordWordRequest({ variantId, normalizedWord: word, submittedByAnonymousId: anonymousId });
  await getPool().execute('UPDATE anonymous_profiles SET last_seen_at = ? WHERE anonymous_id = ?', [lastSeen, anonymousId]);
  return { anonymousId, practiceSessionId, word };
}

const OWNED = Object.freeze({
  profile: 'SELECT COUNT(*) AS n FROM anonymous_profiles WHERE anonymous_id = ?',
  events: 'SELECT COUNT(*) AS n FROM user_activity_events WHERE anonymous_id = ?',
  words: 'SELECT COUNT(*) AS n FROM user_word_states WHERE anonymous_id = ?',
  phonemes: 'SELECT COUNT(*) AS n FROM user_phoneme_states WHERE anonymous_id = ?',
  sm2: 'SELECT COUNT(*) AS n FROM sm2_states WHERE anonymous_id = ?',
  practice: 'SELECT COUNT(*) AS n FROM practice_sessions WHERE anonymous_id = ?',
  consents: 'SELECT COUNT(*) AS n FROM consent_records WHERE anonymous_id = ?',
});
const owned = async (anonymousId) => {
  const counts = {};
  for (const [name, sql] of Object.entries(OWNED)) counts[name] = Number((await getPool().execute(sql, [anonymousId]))[0][0].n);
  return counts;
};
const NONE = { profile: 0, events: 0, words: 0, phonemes: 0, sm2: 0, practice: 0, consents: 0 };
const tombstones = async () =>
  Number((await getPool().query("SELECT COUNT(*) AS n FROM deletion_audit WHERE deletion_type = 'dormancy_anonymous'"))[0][0].n);
const requestOwner = async (word) =>
  (await getPool().execute('SELECT submitted_by_anonymous_id AS owner FROM word_requests WHERE variant_id = ? AND normalized_word = ?', [variantId, word]))[0][0].owner;

describe('NFR-PRIV-02 — the dormancy prune', () => {
  test('the cutoff is two calendar years back', () => {
    expect(dormancyCutoff(new Date('2026-10-01T12:00:00Z')).toISOString()).toBe('2024-10-01T12:00:00.000Z');
  });

  test('a dormant unbound identity is erased with everything it owns; its word request survives ownerless; one tombstone', async () => {
    const dormant = await populatedIdentity(new Date(Date.now() - 2 * YEAR_MS - 24 * 3600 * 1000));
    const before = await tombstones();

    const pruned = await createDormancyService({ practiceQueueStore: queueStore }).pruneDormantProfiles();
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(await owned(dormant.anonymousId)).toEqual(NONE);
    expect(await requestOwner(dormant.word)).toBeNull();
    expect(await queueStore.load(dormant.practiceSessionId)).toBeNull();
    expect(await tombstones()).toBe(before + pruned);
  });

  test('a recent identity, and a dormant one bound to an account, are kept', async () => {
    const recent = await populatedIdentity(new Date(Date.now() - YEAR_MS));
    const bound = await populatedIdentity(new Date(Date.now() - 3 * YEAR_MS));
    await insertLinkBinding({ anonymousId: bound.anonymousId, userId: await newUser(), occurredAt: new Date() });

    await createDormancyService({ practiceQueueStore: queueStore }).pruneDormantProfiles();
    for (const kept of [recent, bound]) {
      expect((await owned(kept.anonymousId)).profile).toBe(1);
      expect((await owned(kept.anonymousId)).events).toBe(2);
      expect(await requestOwner(kept.word)).toBe(kept.anonymousId);
    }
    // Leave nothing dormant behind for other suites: make the recent one ordinary.
    await getPool().execute('UPDATE anonymous_profiles SET last_seen_at = NOW(3) WHERE anonymous_id = ?', [bound.anonymousId]);
  });

  test('concurrent runs: the claim gives each identity one owner, so one tombstone each', async () => {
    const dormant = await populatedIdentity(new Date(Date.now() - 3 * YEAR_MS));
    const before = await tombstones();
    const service = () => createDormancyService({ practiceQueueStore: queueStore });

    const [first, second] = await Promise.all([service().pruneDormantProfiles(), service().pruneDormantProfiles()]);
    expect(first + second).toBeGreaterThanOrEqual(1);
    expect(await owned(dormant.anonymousId)).toEqual(NONE);
    expect(await tombstones()).toBe(before + first + second);
  });

  test('a failure mid-prune rolls everything back, and a retry finishes', async () => {
    const dormant = await populatedIdentity(new Date(Date.now() - 3 * YEAR_MS));
    const before = await owned(dormant.anonymousId);
    // Readings: the candidate cutoff, the claim time, then the tombstone time — after every delete.
    let readings = 0;
    const failing = () => {
      readings += 1;
      if (readings === 3) throw new Error('simulated crash');
      return new Date();
    };
    await expect(createDormancyService({ practiceQueueStore: queueStore, clock: failing }).pruneDormantProfiles()).rejects.toThrow(
      'simulated crash',
    );
    expect(await owned(dormant.anonymousId)).toEqual(before);
    const [[{ claimed }]] = await getPool().execute('SELECT prune_claimed_at AS claimed FROM anonymous_profiles WHERE anonymous_id = ?', [
      dormant.anonymousId,
    ]);
    expect(claimed).toBeNull();

    await createDormancyService({ practiceQueueStore: queueStore }).pruneDormantProfiles();
    expect(await owned(dormant.anonymousId)).toEqual(NONE);
  });
});

describe('NFR-PRIV-02 — routine expiry pruning', () => {
  test('expired tokens are deleted, live ones kept', async () => {
    const userId = await newUser();
    const insert = (offsetMs) =>
      getPool().execute(
        "INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at, created_at) VALUES (?, 'password_reset', ?, ?, NOW(3))",
        [userId, createHash('sha256').update(randomUUID()).digest('hex'), new Date(Date.now() + offsetMs)],
      );
    await insert(-60_000);
    await insert(-3_600_000);
    await insert(3_600_000);

    const deleted = await createRetentionService({ sessionStore: createSessionStore() }).pruneExpiredTokens();
    expect(deleted).toBeGreaterThanOrEqual(2);
    const [rows] = await getPool().execute('SELECT expires_at FROM auth_tokens WHERE user_id = ?', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  test('stale session-index entries are dropped, live ones kept, empty indexes removed', async () => {
    const store = createSessionStore();
    const sessions = createSessionService({ store });
    const live = await newUser();
    const gone = await newUser();
    await sessions.startSession(live, 0);
    await sessions.startSession(gone, 0);
    const staleKey = `session:${'0'.repeat(64)}`;
    await getRedis().sadd(`user_sessions:${live}`, staleKey);
    await getRedis().del(...(await getRedis().smembers(`user_sessions:${gone}`)));

    const removed = await createRetentionService({ sessionStore: store }).pruneSessionIndexes();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await getRedis().sismember(`user_sessions:${live}`, staleKey)).toBe(0);
    expect(await getRedis().scard(`user_sessions:${live}`)).toBe(1);
    expect(await getRedis().exists(`user_sessions:${gone}`)).toBe(0);
    await store.destroyAllForUser(live);
  });
});

describe('SDD §6.5 — the BullMQ boundary', () => {
  const prefix = `test-${randomUUID().slice(0, 8)}`;

  async function cleanup(connection) {
    let cursor = '0';
    do {
      const [next, keys] = await connection.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) await connection.del(...keys);
    } while (cursor !== '0');
  }

  test('each worker declares its schedules; registering twice never doubles them; undeclared ones are removed', async () => {
    const connection = createJobConnection();
    const noop = async () => 0;
    const definitions = {
      [QUEUES.ERASURE]: erasureJobs({ accountDeletionService: { purgeDueAccounts: noop }, dormancyService: { pruneDormantProfiles: noop } }),
      [QUEUES.MAINTENANCE]: maintenanceJobs({ retentionService: { pruneExpiredTokens: noop, pruneSessionIndexes: noop } }),
      [QUEUES.APP]: appJobs({ practiceService: { sweepIdleSessions: noop } }),
    };
    try {
      for (const [queueName, jobs] of Object.entries(definitions)) {
        const first = await startJobWorker({ queueName, jobs: [...jobs, { name: 'retired', repeat: { every: 60_000 }, run: noop }], connection, prefix, onExhausted: noop });
        await first.close();
        const second = await startJobWorker({ queueName, jobs, connection, prefix, onExhausted: noop });
        const schedulers = await second.queue.getJobSchedulers();
        expect(schedulers.map((scheduler) => scheduler.key).sort()).toEqual(jobs.map((job) => job.name).sort());
        await second.close();
      }
      expect(definitions[QUEUES.ERASURE].find((job) => job.name === 'account-purge').repeat.pattern).toBe('5 * * * *');
    } finally {
      await cleanup(connection);
      await connection.quit();
    }
  }, 30_000);

  test('a job runs its adapter; one that exhausts its retries raises the alert', async () => {
    const connection = createJobConnection();
    const ran = [];
    const alerts = [];
    let resolveAlert;
    const alerted = new Promise((resolve) => {
      resolveAlert = resolve;
    });
    const jobs = [
      {
        name: 'works',
        repeat: { every: 3_600_000 },
        run: async () => {
          ran.push('works');
          return { ok: true };
        },
      },
      { name: 'breaks', repeat: { every: 3_600_000 }, run: async () => Promise.reject(Object.assign(new Error('boom'), { code: 'E_TEST' })) },
    ];
    const running = await startJobWorker({
      queueName: `adhoc-${randomUUID().slice(0, 8)}`,
      jobs,
      connection,
      prefix,
      onExhausted: async (jobName, error) => {
        alerts.push({ jobName, code: error.code });
        resolveAlert();
      },
    });
    try {
      const done = await running.queue.add('works', {}, { attempts: 1 });
      await running.queue.add('breaks', {}, { attempts: 1 });
      await alerted;
      for (let wait = 0; wait < 50 && !(await done.isCompleted()); wait += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      expect(ran).toContain('works');
      expect(alerts).toContainEqual({ jobName: 'breaks', code: 'E_TEST' });
    } finally {
      await running.close();
      await cleanup(connection);
      await connection.quit();
    }
  }, 30_000);
});
