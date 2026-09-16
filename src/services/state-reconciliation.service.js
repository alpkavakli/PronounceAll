/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Derived save-state reconciliation (FR-SAVE-04, B3; SDD v1.1 §4.5, §6.5).
 *
 * `user_word_states` and `user_phoneme_states` are a projection of the
 * append-only log. This recomputes the projection from the log for each
 * resolved owner, using the FR-SAVE-02 transitions in `(occurred_at, event_id)`
 * order (C5) and ignoring the events FR-SAVE-04 excludes, and compares it with
 * the live rows.
 *
 *   - `dryRun` reports drift and changes nothing;
 *   - `apply` repairs drift, per owner, inside one transaction that first locks
 *     that owner's derived rows (the C6 per-actor claim).
 *
 * The log is never updated or deleted. A derived row with no qualifying event
 * behind it is reported as `unexplained` and left in place: removing it would
 * need a DELETE the application does not hold, and a row that should not exist
 * is a finding for a person rather than something to erase automatically.
 *
 * One implementation, several entry points (C4): the script
 * `scripts/reconcile-save-state.js` and the job adapter in `src/jobs/` both call
 * {@link reconcileSaveState}.
 */

import {
  listOwnerStateEvents,
  listOwnerStates,
  listReconciliationOwners,
  lockOwnerStates,
  repairTargetState,
} from '../repositories/progress.repository.js';
import { withTransaction } from '../repositories/transaction.js';

/** Events that never affect derived state (FR-SAVE-04). */
export const NON_STATE_EVENTS = Object.freeze([
  'audio_listen_word',
  'audio_listen_phoneme',
  'practice_attempt',
  'word_encounter',
]);

const keyOf = (targetKind, targetId) => `${targetKind}:${targetId}`;

/**
 * Replay a target's events into its state (FR-SAVE-02).
 *
 * @param {Array<{ eventId: number, targetKind: string, targetId: number, eventType: string, eventValue: string|null }>} events
 *   already in `(target, occurred_at, event_id)` order
 * @returns {Map<string, { targetKind: string, targetId: number, state: string, lastEventId: number }>}
 */
export function deriveExpectedStates(events) {
  const expected = new Map();
  for (const event of events) {
    if (NON_STATE_EVENTS.includes(event.eventType)) continue;
    const state =
      event.eventType === 'save'
        ? 'saved'
        : event.eventType === 'unsave'
          ? 'unsaved'
          : event.eventType === 'tag_change'
            ? (event.eventValue ?? 'saved')
            : null;
    if (state === null) continue;
    expected.set(keyOf(event.targetKind, event.targetId), {
      targetKind: event.targetKind,
      targetId: event.targetId,
      state,
      lastEventId: event.eventId,
    });
  }
  return expected;
}

/**
 * @param {Map<string, object>} expected
 * @param {Array<{ targetKind: string, targetId: number, state: string, lastEventId: number }>} live
 * @returns {Array<{ kind: 'missing'|'mismatch'|'unexplained', targetKind: string, targetId: number, expected?: object, live?: object }>}
 */
export function diffStates(expected, live) {
  const drift = [];
  const liveByKey = new Map(live.map((row) => [keyOf(row.targetKind, row.targetId), row]));

  for (const [key, want] of expected) {
    const have = liveByKey.get(key);
    if (!have) {
      drift.push({ kind: 'missing', targetKind: want.targetKind, targetId: want.targetId, expected: want });
    } else if (have.state !== want.state || have.lastEventId !== want.lastEventId) {
      drift.push({ kind: 'mismatch', targetKind: want.targetKind, targetId: want.targetId, expected: want, live: have });
    }
  }
  for (const [key, have] of liveByKey) {
    if (!expected.has(key)) {
      drift.push({ kind: 'unexplained', targetKind: have.targetKind, targetId: have.targetId, live: have });
    }
  }
  return drift;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.apply] repair drift; the default is a dry run
 * @param {() => Date} [options.clock]
 * @returns {Promise<{ owners: number, drift: Array<object>, repaired: number }>}
 */
export async function reconcileSaveState({ apply = false, clock = () => new Date() } = {}) {
  const owners = await listReconciliationOwners();
  const drift = [];
  let repaired = 0;

  for (const owner of owners) {
    if (!apply) {
      const [events, live] = await Promise.all([listOwnerStateEvents(owner), listOwnerStates(owner)]);
      for (const entry of diffStates(deriveExpectedStates(events), live)) drift.push({ owner, ...entry });
      continue;
    }

    const found = await withTransaction(async (tx) => {
      await lockOwnerStates(owner, tx);
      const events = await listOwnerStateEvents(owner, tx);
      const live = await listOwnerStates(owner, tx);
      const entries = diffStates(deriveExpectedStates(events), live);
      const now = clock();
      for (const entry of entries) {
        if (entry.kind === 'unexplained') continue;
        await repairTargetState({ owner, ...entry.expected, updatedAt: now }, tx);
        repaired += 1;
      }
      return entries;
    });
    for (const entry of found) drift.push({ owner, ...entry });
  }

  return { owners: owners.length, drift, repaired };
}
