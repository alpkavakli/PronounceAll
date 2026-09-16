/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * FR-SAVE-04 reconciliation against the real database.
 *
 * Drift is manufactured the way it would really arise — events in the log whose
 * projection was lost or corrupted — by writing events and rows directly. The
 * reconciliation must report it without changing anything in a dry run, repair
 * it with apply, find nothing on a second run, and never touch the log.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { generateAnonymousId } from '../../src/lib/ids.js';
import { closePool, getPool } from '../../src/lib/mysql.js';
import { closeRedis } from '../../src/lib/redis.js';
import { insertActivityEvent, touchAnonymousProfile } from '../../src/repositories/progress.repository.js';
import { reconcileSaveState } from '../../src/services/state-reconciliation.service.js';

let wordId;
let phonemeId;
const actors = [];

async function newActor() {
  const anonymousId = generateAnonymousId();
  actors.push(anonymousId);
  await touchAnonymousProfile(anonymousId, new Date());
  return anonymousId;
}

/** Append an event with an explicit time, as the log would hold it. */
const append = (anonymousId, eventType, { value = null, kind = 'word', target = wordId, at } = {}) =>
  insertActivityEvent({
    owner: { anonymousId },
    targetKind: kind,
    targetId: target,
    eventType,
    eventValue: value,
    occurredAt: at ?? new Date(),
  });

const mine = (result, anonymousId) => result.drift.filter((entry) => entry.owner.anonymousId === anonymousId);

async function logOf(anonymousId) {
  const [rows] = await getPool().execute(
    'SELECT event_id, event_type, event_value, occurred_at FROM user_activity_events WHERE anonymous_id = ? ORDER BY event_id',
    [anonymousId],
  );
  return rows;
}

async function wordState(anonymousId) {
  const [rows] = await getPool().execute(
    'SELECT state, last_event_id FROM user_word_states WHERE anonymous_id = ? AND word_id = ?',
    [anonymousId, wordId],
  );
  return rows[0] ? { state: rows[0].state, lastEventId: Number(rows[0].last_event_id) } : undefined;
}

beforeAll(async () => {
  const [[word]] = await getPool().execute("SELECT word_id FROM words WHERE normalized_headword = 'cupcake'");
  wordId = Number(word.word_id);
  const [[phoneme]] = await getPool().execute('SELECT phoneme_id FROM phonemes ORDER BY frequency_rank LIMIT 1');
  phonemeId = Number(phoneme.phoneme_id);
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

describe('FR-SAVE-04 reconciliation', () => {
  test('a lost projection is reported by the dry run, repaired by apply, and clean on a second run', async () => {
    const actor = await newActor();
    await append(actor, 'save');
    await append(actor, 'tag_change', { value: 'learning' });
    const last = await append(actor, 'tag_change', { value: 'learned' });
    const logBefore = await logOf(actor);

    const dry = await reconcileSaveState();
    expect(mine(dry, actor)).toEqual([
      expect.objectContaining({ kind: 'missing', targetKind: 'word', targetId: wordId }),
    ]);
    expect(await wordState(actor)).toBeUndefined();

    const applied = await reconcileSaveState({ apply: true });
    expect(mine(applied, actor)).toHaveLength(1);
    expect(await wordState(actor)).toEqual({ state: 'learned', lastEventId: last });

    const again = await reconcileSaveState({ apply: true });
    expect(mine(again, actor)).toEqual([]);
    expect(await logOf(actor)).toEqual(logBefore);
  });

  test('a corrupted row is corrected to the latest event, not merely moved forward', async () => {
    const actor = await newActor();
    await append(actor, 'save');
    const unsave = await append(actor, 'unsave');
    // Corruption: the row claims a later-looking state the log does not support.
    await getPool().execute(
      "INSERT INTO user_word_states (anonymous_id, word_id, state, last_event_id, updated_at) VALUES (?, ?, 'learned', ?, NOW(3))",
      [actor, wordId, unsave],
    );

    expect(mine(await reconcileSaveState(), actor)).toEqual([expect.objectContaining({ kind: 'mismatch' })]);
    await reconcileSaveState({ apply: true });
    expect(await wordState(actor)).toEqual({ state: 'unsaved', lastEventId: unsave });
  });

  test('ties on occurred_at resolve by event_id, and non-state events are ignored', async () => {
    const actor = await newActor();
    const at = new Date('2026-09-17T10:00:00.000Z');
    await append(actor, 'save', { at });
    const learned = await append(actor, 'tag_change', { value: 'learned', at });
    await append(actor, 'audio_listen_word', { at: new Date('2026-09-17T11:00:00.000Z') });
    await append(actor, 'word_encounter', { at: new Date('2026-09-17T11:00:01.000Z') });
    await append(actor, 'practice_attempt', { value: '2', at: new Date('2026-09-17T11:00:02.000Z') });
    await append(actor, 'audio_listen_phoneme', { kind: 'phoneme', target: phonemeId });

    await reconcileSaveState({ apply: true });
    expect(await wordState(actor)).toEqual({ state: 'learned', lastEventId: learned });
    const [phonemeRows] = await getPool().execute('SELECT 1 FROM user_phoneme_states WHERE anonymous_id = ?', [actor]);
    expect(phonemeRows).toHaveLength(0);
  });

  test('the dry run changes nothing even when drift exists', async () => {
    const actor = await newActor();
    await append(actor, 'save');
    const [[before]] = await getPool().execute('SELECT COUNT(*) AS n FROM user_word_states');
    await reconcileSaveState();
    const [[after]] = await getPool().execute('SELECT COUNT(*) AS n FROM user_word_states');
    expect(Number(after.n)).toBe(Number(before.n));
    expect(await wordState(actor)).toBeUndefined();
  });
});
