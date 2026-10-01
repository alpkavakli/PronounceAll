/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Deleting an account, Iteration 6 slice 3 (FR-SET-07/08/09; SDD v1.1 §4.9,
 * §5.5, C6; V3): the two-step request, restoration by signing in, and the
 * purge job's ordered, claimed, single-transaction erasure.
 */

import { randomInt, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';

process.env.RATE_LIMIT_STORE = 'memory';

const { createApp } = await import('../../src/app.js');
const { config } = await import('../../src/config/index.js');
const { createFlowSecretStore } = await import('../../src/lib/flow-secret-store.js');
const { generateAnonymousId } = await import('../../src/lib/ids.js');
const { closePool, getPool } = await import('../../src/lib/mysql.js');
const { hashPassword, verifyPassword } = await import('../../src/lib/passwords.js');
const { createPracticeQueueStore } = await import('../../src/lib/practice-queue-store.js');
const { closeRedis } = await import('../../src/lib/redis.js');
const { createSessionStore } = await import('../../src/lib/session-store.js');
const { insertConsent } = await import('../../src/repositories/consent.repository.js');
const { insertLinkBinding } = await import('../../src/repositories/identity-bindings.repository.js');
const { insertAttempt, insertSession, upsertSm2State } = await import('../../src/repositories/practice.repository.js');
const { insertActivityEvent, touchAnonymousProfile, upsertTargetState } = await import(
  '../../src/repositories/progress.repository.js'
);
const { recordWordRequest } = await import('../../src/repositories/word-requests.repository.js');
const { createAccountDeletionService, SOFT_DELETE_GRACE_MS } = await import('../../src/services/account-deletion.service.js');
const { issueCsrfTokenFor } = await import('../../src/services/csrf.service.js');
const { createSessionService } = await import('../../src/services/session.service.js');

const ORIGIN = new URL(config.baseUrl).origin;
const PASSWORD = 'zq-the-deletion-passphrase';
const DAY_MS = 24 * 60 * 60 * 1000;

let outbox = [];
const newApp = () =>
  createApp({
    isBreachedPassword: async () => false,
    sendMail: async (message) => void outbox.push(message),
    googleOidc: null,
  });
const sessions = createSessionService({ store: createSessionStore() });
const queueStore = createPracticeQueueStore();
const deletion = (clock) =>
  createAccountDeletionService({
    passwords: { verifyPassword },
    sessionService: sessions,
    secrets: createFlowSecretStore(),
    practiceQueueStore: queueStore,
    sendMail: async (message) => void outbox.push(message),
    contactEmail: config.contactEmail,
    ...(clock ? { clock } : {}),
  });
const userIds = [];
const requestWords = [];
let wordIds;
let phonemeId;
let variantId;

beforeAll(async () => {
  wordIds = (await getPool().query('SELECT word_id FROM words ORDER BY word_id LIMIT 2'))[0].map((row) => Number(row.word_id));
  phonemeId = Number((await getPool().query('SELECT phoneme_id FROM phonemes ORDER BY phoneme_id LIMIT 1'))[0][0].phoneme_id);
  variantId = Number((await getPool().query('SELECT variant_id FROM language_variants ORDER BY variant_id LIMIT 1'))[0][0].variant_id);
});

beforeEach(() => {
  outbox = [];
});

/** A password account, optionally with a verified email, and a session for it. */
async function account({ email = null } = {}) {
  const now = new Date();
  const name = `zzd${generateAnonymousId().replaceAll('-', '').slice(0, 12)}`;
  const [result] = await getPool().execute(
    'INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [name, name, now, now],
  );
  const userId = Number(result.insertId);
  userIds.push(userId);
  await getPool().execute(
    `INSERT INTO user_accounts (user_id, provider, email, email_lower, email_verified_at, password_hash, created_at, updated_at)
          VALUES (?, 'password', ?, ?, ?, ?, ?, ?)`,
    [userId, email, email?.toLowerCase() ?? null, email ? now : null, await hashPassword(PASSWORD), now, now],
  );
  return { userId, username: name, sessionId: await sessions.startSession(userId, 0) };
}

function post(app, path, sessionId, fields) {
  const body = new URLSearchParams({ ...fields, _csrf: issueCsrfTokenFor(config.csrf.secret, { sessionId }) });
  return request(app)
    .post(path)
    .set('Cookie', [`pa_uid=${generateAnonymousId()}`, `pa_sid=${sessionId}`])
    .set('Origin', ORIGIN)
    .type('form')
    .send(body.toString());
}

function login(app, identifier, password = PASSWORD) {
  const anonymousId = generateAnonymousId();
  return request(app)
    .post('/login')
    .set('Cookie', [`pa_uid=${anonymousId}`])
    .set('Origin', ORIGIN)
    .type('form')
    .send(
      new URLSearchParams({
        identifier,
        password,
        'cf-turnstile-response': 'test-token',
        _csrf: issueCsrfTokenFor(config.csrf.secret, { anonymousId }),
      }).toString(),
    );
}

const userRow = async (userId) => (await getPool().execute('SELECT * FROM users WHERE user_id = ?', [userId]))[0][0];
const signedIn = async (app, sessionId) =>
  (await request(app).get('/settings').set('Cookie', [`pa_uid=${generateAnonymousId()}`, `pa_sid=${sessionId}`])).text.includes(
    'Signed in as',
  );
const nonceIn = (html) => html.match(/name="reauth" value="([A-Za-z0-9_-]{43})"/)?.[1] ?? null;
const newAddress = () => `zzd-${generateAnonymousId().slice(0, 13)}@example.test`;

/** Step 1 with the password, then step 2 with the chosen option. */
async function deleteThroughSettings(app, sessionId, option) {
  const reauth = await post(app, '/settings/delete/reauth', sessionId, { password: PASSWORD });
  expect(reauth.status).toBe(200);
  const nonce = nonceIn(reauth.text);
  expect(nonce).not.toBeNull();
  return post(app, '/settings/delete', sessionId, { reauth: nonce, option });
}

afterAll(async () => {
  // Whatever a test left behind, the job itself erases: mark it due, then purge.
  const pool = getPool();
  for (const id of userIds) {
    await pool.execute(
      "UPDATE users SET deletion_state = 'hard_delete_scheduled', hard_delete_scheduled_at = NOW(3) WHERE user_id = ? AND deletion_state <> 'hard_delete_in_progress'",
      [id],
    );
  }
  await deletion().purgeDueAccounts();
  for (const word of requestWords) {
    await pool.execute('DELETE FROM word_requests WHERE variant_id = ? AND normalized_word = ?', [variantId, word]);
  }
  await closePool();
  await closeRedis();
});

describe('FR-SET-07 — step 1: explanation and re-authentication', () => {
  test('Settings links to the flow; signed out, the flow sends you to sign in', async () => {
    const app = newApp();
    const { sessionId } = await account();
    const settings = await request(app).get('/settings').set('Cookie', [`pa_uid=${generateAnonymousId()}`, `pa_sid=${sessionId}`]);
    expect(settings.text).toContain('href="/settings/delete"');

    const signedOut = await request(app).get('/settings/delete').set('Cookie', [`pa_uid=${generateAnonymousId()}`]);
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.location).toBe('/login');
  });

  test('step 1 explains both options and asks for the password', async () => {
    const { sessionId } = await account();
    const response = await request(newApp())
      .get('/settings/delete')
      .set('Cookie', [`pa_uid=${generateAnonymousId()}`, `pa_sid=${sessionId}`]);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.text).toContain('30 days to change your mind');
    expect(response.text).toContain('This cannot be undone');
    expect(response.text).toContain('action="/settings/delete/reauth"');
    expect(nonceIn(response.text)).toBeNull();
  });

  test('a wrong password aborts the flow: nothing scheduled, no proof issued, still signed in', async () => {
    const app = newApp();
    const { userId, sessionId } = await account({ email: newAddress() });
    const before = await userRow(userId);

    const response = await post(app, '/settings/delete/reauth', sessionId, { password: 'not it' });
    expect(response.status).toBe(400);
    expect(response.text).toContain('That is not your current password.');
    expect(nonceIn(response.text)).toBeNull();
    expect(await userRow(userId)).toEqual(before);
    expect(await signedIn(app, sessionId)).toBe(true);
    expect(outbox).toHaveLength(0);
  });

  test('re-authentication requires the CSRF token', async () => {
    const { sessionId } = await account();
    const response = await request(newApp())
      .post('/settings/delete/reauth')
      .set('Cookie', [`pa_uid=${generateAnonymousId()}`, `pa_sid=${sessionId}`])
      .set('Origin', ORIGIN)
      .type('form')
      .send(new URLSearchParams({ password: PASSWORD }).toString());
    expect(response.status).toBe(403);
    expect(nonceIn(response.text)).toBeNull();
  });
});

describe('FR-SET-07 — step 2: the proof and the choice', () => {
  test('soft delete: closed, purge at now + 30 days, every session ended, signed out, one email', async () => {
    const app = newApp();
    const email = newAddress();
    const { userId, sessionId } = await account({ email });
    const otherDevice = await sessions.startSession(userId, 0);
    const before = await userRow(userId);
    const startedAt = Date.now();

    const response = await deleteThroughSettings(app, sessionId, 'soft');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Your account is deleted');
    expect([response.headers['set-cookie']].flat().some((line) => /^pa_sid=;/.test(line))).toBe(true);

    const after = await userRow(userId);
    expect(after.deletion_state).toBe('soft_deleted');
    expect(after.session_epoch).toBe(before.session_epoch + 1);
    expect(after.soft_deleted_at).not.toBeNull();
    const purgeAt = after.hard_delete_scheduled_at.getTime();
    expect(purgeAt).toBeGreaterThanOrEqual(startedAt + SOFT_DELETE_GRACE_MS - 1000);
    expect(purgeAt).toBeLessThanOrEqual(Date.now() + SOFT_DELETE_GRACE_MS + 1000);

    expect(await signedIn(app, sessionId)).toBe(false);
    expect(await signedIn(app, otherDevice)).toBe(false);

    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(email);
    expect(outbox[0].text).toContain("This wasn't me");
    expect(outbox[0].text).toContain(config.contactEmail);
  });

  test('hard delete: due at once; with no verified email, no email is sent', async () => {
    const app = newApp();
    const { userId, sessionId } = await account();
    const response = await deleteThroughSettings(app, sessionId, 'hard');
    expect(response.status).toBe(200);
    expect(response.text).toContain('erased within 24 hours');

    const after = await userRow(userId);
    expect(after.deletion_state).toBe('hard_delete_scheduled');
    expect(after.hard_delete_scheduled_at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await signedIn(app, sessionId)).toBe(false);
    expect(outbox).toHaveLength(0);
  });

  test('no proof, a forged proof, or a proof from another session: refused, nothing scheduled', async () => {
    const app = newApp();
    const { userId, sessionId } = await account();
    const secondDevice = await sessions.startSession(userId, 0);
    const before = await userRow(userId);

    expect((await post(app, '/settings/delete', sessionId, { option: 'hard' })).status).toBe(400);
    expect((await post(app, '/settings/delete', sessionId, { reauth: 'A'.repeat(43), option: 'hard' })).status).toBe(400);

    const reauth = await post(app, '/settings/delete/reauth', sessionId, { password: PASSWORD });
    const nonce = nonceIn(reauth.text);
    const foreign = await post(app, '/settings/delete', secondDevice, { reauth: nonce, option: 'hard' });
    expect(foreign.status).toBe(400);
    expect(foreign.text).toContain('That confirmation has expired');

    expect(await userRow(userId)).toEqual(before);
    expect(await signedIn(app, sessionId)).toBe(true);
  });

  test('a proof works once', async () => {
    const service = deletion();
    const { userId, sessionId } = await account();
    const nonce = await service.reauthenticateWithPassword({ userId, sessionId, password: PASSWORD });
    // Restore between uses, so only the proof can make the second one fail.
    await service.requestDeletion({ userId, sessionId, nonce, option: 'soft' });
    await getPool().execute("UPDATE users SET deletion_state = 'none' WHERE user_id = ?", [userId]);
    await expect(service.requestDeletion({ userId, sessionId, nonce, option: 'soft' })).rejects.toThrow(
      'That confirmation has expired',
    );
    expect((await userRow(userId)).deletion_state).toBe('none');
  });

  test('no option chosen: the same proof is offered again', async () => {
    const app = newApp();
    const { userId, sessionId } = await account();
    const reauth = await post(app, '/settings/delete/reauth', sessionId, { password: PASSWORD });
    const nonce = nonceIn(reauth.text);

    const missing = await post(app, '/settings/delete', sessionId, { reauth: nonce });
    expect(missing.status).toBe(400);
    expect(nonceIn(missing.text)).toBe(nonce);

    expect((await post(app, '/settings/delete', sessionId, { reauth: nonce, option: 'soft' })).status).toBe(200);
    expect((await userRow(userId)).deletion_state).toBe('soft_deleted');
  });
});

describe('FR-SET-09 — restoring by signing in', () => {
  test('inside the window: restored, recorded, and signed in', async () => {
    const app = newApp();
    const { userId, username, sessionId } = await account();
    await deleteThroughSettings(app, sessionId, 'soft');

    const response = await login(app, username);
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/login?restored=1');

    const after = await userRow(userId);
    expect(after).toMatchObject({ deletion_state: 'none', soft_deleted_at: null, hard_delete_scheduled_at: null });
    const [consents] = await getPool().execute(
      "SELECT consent_value FROM consent_records WHERE user_id = ? AND consent_type = 'account_restored'",
      [userId],
    );
    expect(consents).toHaveLength(1);

    // A restored account is not purged by a job that selected it earlier.
    expect(await deletion().purgeDueAccounts()).toBeGreaterThanOrEqual(0);
    expect(await userRow(userId)).toBeDefined();
  });

  test('a wrong password on a soft-deleted account is the generic failure and restores nothing', async () => {
    const app = newApp();
    const { userId, username, sessionId } = await account();
    await deleteThroughSettings(app, sessionId, 'soft');

    const response = await login(app, username, 'not it');
    expect(response.status).toBe(401);
    expect((await userRow(userId)).deletion_state).toBe('soft_deleted');
  });

  test('past the window, or after a hard delete: the generic failure', async () => {
    const app = newApp();
    const expired = await account();
    await deleteThroughSettings(app, expired.sessionId, 'soft');
    await getPool().execute('UPDATE users SET hard_delete_scheduled_at = ? WHERE user_id = ?', [new Date(Date.now() - DAY_MS), expired.userId]);
    const late = await login(app, expired.username);
    expect(late.status).toBe(401);
    expect((await userRow(expired.userId)).deletion_state).toBe('soft_deleted');

    const hard = await account();
    await deleteThroughSettings(app, hard.sessionId, 'hard');
    expect((await login(app, hard.username)).status).toBe(401);
    expect((await userRow(hard.userId)).deletion_state).toBe('hard_delete_scheduled');
  });
});

describe('FR-SET-08 — the purge job', () => {
  /** An account with something in every table the purge must empty. */
  async function populatedAccount() {
    const email = newAddress();
    const { userId, username, sessionId } = await account({ email });
    const anonymousId = generateAnonymousId();
    const now = new Date();
    const word = `zzd${randomInt(0, 2 ** 31)}`;
    requestWords.push(word);

    await touchAnonymousProfile(anonymousId, now);
    await insertLinkBinding({ anonymousId, userId, occurredAt: now });
    for (const owner of [{ userId }, { anonymousId }]) {
      const eventId = await insertActivityEvent({
        owner,
        targetKind: 'word',
        targetId: wordIds[0],
        eventType: 'save',
        eventValue: null,
        occurredAt: now,
      });
      await upsertTargetState({ owner, targetKind: 'word', targetId: wordIds[0], state: 'saved', lastEventId: eventId, updatedAt: now });
      const phonemeEvent = await insertActivityEvent({
        owner,
        targetKind: 'phoneme',
        targetId: phonemeId,
        eventType: 'save',
        eventValue: null,
        occurredAt: now,
      });
      await upsertTargetState({ owner, targetKind: 'phoneme', targetId: phonemeId, state: 'saved', lastEventId: phonemeEvent, updatedAt: now });
      await upsertSm2State({
        owner,
        wordId: wordIds[0],
        state: { repetitionCount: 1, easeFactor: 2.5, intervalDays: 1 },
        nextDueAt: now,
        reviewedAt: now,
      });
      const practiceSessionId = await insertSession(owner, now, [{ wordId: wordIds[0], tag: 'saved' }]);
      await insertAttempt({ sessionId: practiceSessionId, wordId: wordIds[0], turnSeq: 1, rating: 'right', now });
      await queueStore.save(practiceSessionId, { turns: [] });
      await insertConsent({ owner, consentType: 'ads_opt_in', consentValue: 'granted', policyVersion: 'test', now });
    }
    await recordWordRequest({ variantId, normalizedWord: word, submittedByUserId: userId, submittedByAnonymousId: anonymousId });
    await getPool().execute(
      "INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at, created_at) VALUES (?, 'password_reset', ?, NOW(3) + INTERVAL 1 HOUR, NOW(3))",
      [userId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
    );
    return { userId, username, email, anonymousId, sessionId, word };
  }

  const COUNTS = Object.freeze({
    users: 'SELECT COUNT(*) AS n FROM users WHERE user_id = ?',
    accounts: 'SELECT COUNT(*) AS n FROM user_accounts WHERE user_id = ?',
    tokens: 'SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ?',
    bindings: 'SELECT COUNT(*) AS n FROM identity_bindings WHERE user_id = ?',
    userEvents: 'SELECT COUNT(*) AS n FROM user_activity_events WHERE user_id = ?',
    userWords: 'SELECT COUNT(*) AS n FROM user_word_states WHERE user_id = ?',
    userPhonemes: 'SELECT COUNT(*) AS n FROM user_phoneme_states WHERE user_id = ?',
    userSm2: 'SELECT COUNT(*) AS n FROM sm2_states WHERE user_id = ?',
    userPractice: 'SELECT COUNT(*) AS n FROM practice_sessions WHERE user_id = ?',
    userConsents: 'SELECT COUNT(*) AS n FROM consent_records WHERE user_id = ?',
  });
  const ANONYMOUS_COUNTS = Object.freeze({
    profile: 'SELECT COUNT(*) AS n FROM anonymous_profiles WHERE anonymous_id = ?',
    events: 'SELECT COUNT(*) AS n FROM user_activity_events WHERE anonymous_id = ?',
    words: 'SELECT COUNT(*) AS n FROM user_word_states WHERE anonymous_id = ?',
    phonemes: 'SELECT COUNT(*) AS n FROM user_phoneme_states WHERE anonymous_id = ?',
    sm2: 'SELECT COUNT(*) AS n FROM sm2_states WHERE anonymous_id = ?',
    practice: 'SELECT COUNT(*) AS n FROM practice_sessions WHERE anonymous_id = ?',
    consents: 'SELECT COUNT(*) AS n FROM consent_records WHERE anonymous_id = ?',
  });
  const countsFor = async (statements, key) => {
    const counts = {};
    for (const [name, sql] of Object.entries(statements)) counts[name] = Number((await getPool().execute(sql, [key]))[0][0].n);
    return counts;
  };
  const tombstones = async () => Number((await getPool().query('SELECT COUNT(*) AS n FROM deletion_audit'))[0][0].n);

  test('a due account is erased with its bound identities; word requests survive ownerless; one PII-free tombstone', async () => {
    const app = newApp();
    const subject = await populatedAccount();
    await deleteThroughSettings(app, subject.sessionId, 'hard');
    const [[{ practiceSessionId }]] = await getPool().execute(
      'SELECT MIN(session_id) AS practiceSessionId FROM practice_sessions WHERE anonymous_id = ?',
      [subject.anonymousId],
    );
    const tombstonesBefore = await tombstones();
    const startedAt = new Date(Date.now() - 1000);

    // Earlier tests leave other accounts due; each erased account has one tombstone.
    const erased = await deletion().purgeDueAccounts();
    expect(erased).toBeGreaterThanOrEqual(1);

    expect(Object.values(await countsFor(COUNTS, subject.userId)).every((n) => n === 0)).toBe(true);
    expect(await countsFor(ANONYMOUS_COUNTS, subject.anonymousId)).toEqual({
      profile: 0, events: 0, words: 0, phonemes: 0, sm2: 0, practice: 0, consents: 0,
    });
    expect(await queueStore.load(Number(practiceSessionId))).toBeNull();

    const [[wordRequest]] = await getPool().execute(
      'SELECT submitted_by_user_id, submitted_by_anonymous_id FROM word_requests WHERE variant_id = ? AND normalized_word = ?',
      [variantId, subject.word],
    );
    expect(wordRequest).toEqual({ submitted_by_user_id: null, submitted_by_anonymous_id: null });

    expect(await tombstones()).toBe(tombstonesBefore + erased);
    const [[tombstone]] = await getPool().execute(
      'SELECT * FROM deletion_audit WHERE completed_at >= ? ORDER BY completed_at DESC LIMIT 1',
      [startedAt],
    );
    expect(Object.keys(tombstone).sort()).toEqual(['completed_at', 'deletion_id', 'deletion_type']);
    expect(tombstone.deletion_type).toBe('hard_user');
    expect(JSON.stringify(tombstone)).not.toContain(subject.username);
    expect(JSON.stringify(tombstone)).not.toContain(String(subject.userId));
  });

  test('after the purge, the username and email can be registered again', async () => {
    const app = newApp();
    const subject = await populatedAccount();
    await deleteThroughSettings(app, subject.sessionId, 'hard');
    await deletion().purgeDueAccounts();

    const now = new Date();
    const [reused] = await getPool().execute(
      'INSERT INTO users (username, username_lower, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [subject.username, subject.username, now, now],
    );
    userIds.push(Number(reused.insertId));
    await getPool().execute(
      `INSERT INTO user_accounts (user_id, provider, email, email_lower, email_verified_at, password_hash, created_at, updated_at)
            VALUES (?, 'password', ?, ?, ?, 'x', ?, ?)`,
      [Number(reused.insertId), subject.email, subject.email.toLowerCase(), now, now, now],
    );
  });

  test('a soft delete inside its window is kept; past it, it is erased', async () => {
    const app = newApp();
    const subject = await account();
    await deleteThroughSettings(app, subject.sessionId, 'soft');

    await deletion().purgeDueAccounts();
    expect((await userRow(subject.userId)).deletion_state).toBe('soft_deleted');

    const day31 = () => new Date(Date.now() + 31 * DAY_MS);
    await deletion(day31).purgeDueAccounts();
    expect(await userRow(subject.userId)).toBeUndefined();
  });

  test('concurrent jobs: the claim gives each account one owner, so one tombstone', async () => {
    const app = newApp();
    const subject = await populatedAccount();
    await deleteThroughSettings(app, subject.sessionId, 'hard');
    const before = await tombstones();

    const [first, second] = await Promise.all([deletion().purgeDueAccounts(), deletion().purgeDueAccounts()]);
    expect(first + second).toBeGreaterThanOrEqual(1);
    expect(await userRow(subject.userId)).toBeUndefined();
    expect(await tombstones()).toBe(before + first + second);
  });

  test('a failure mid-purge rolls everything back, and a retry finishes the job', async () => {
    const app = newApp();
    const subject = await populatedAccount();
    await deleteThroughSettings(app, subject.sessionId, 'hard');
    const before = await countsFor(COUNTS, subject.userId);

    // The third clock reading is the tombstone's: inside the transaction, after every delete.
    let readings = 0;
    const failing = () => {
      readings += 1;
      if (readings === 3) throw new Error('simulated crash');
      return new Date();
    };
    await expect(deletion(failing).purgeDueAccounts()).rejects.toThrow('simulated crash');
    expect(await countsFor(COUNTS, subject.userId)).toEqual(before);
    expect((await userRow(subject.userId)).deletion_state).toBe('hard_delete_scheduled');

    await deletion().purgeDueAccounts();
    expect(await userRow(subject.userId)).toBeUndefined();
  });
});
