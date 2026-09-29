/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The save and tag write (FR-SAVE-01..05, FR-SAVE-08, FR-AUTH-03; SDD v1.1 §5.2,
 * B1, B3, C5).
 *
 * One service operation owns the boundary: inside ONE transaction it creates or
 * refreshes the anonymous profile, resolves the owner, locks the target's
 * current state, appends the event, and projects it onto the derived state. A
 * reader therefore never sees an event without its projection (B3).
 *
 * The state machine is FR-SAVE-02:
 *
 *   save    unsaved → saved
 *   unsave  saved | learning | learned → unsaved
 *   tag     saved | learning | learned → saved (null) | learning | learned
 *
 * An action that would not change the state writes nothing and returns the
 * current state, so a repeated or duplicated request is harmless even without
 * its idempotency reservation. Tagging an unsaved target is refused: FR-SAVE-02
 * only reaches the tag choice from a saved state.
 */

import { AppError } from '../errors/index.js';
import {
  findBoundUserId,
  insertActivityEvent,
  lockTargetState,
  targetExists,
  touchAnonymousProfile,
  upsertTargetState,
} from '../repositories/progress.repository.js';
import { withTransaction } from '../repositories/transaction.js';

export const TARGET_KINDS = Object.freeze(['word', 'phoneme']);
export const SAVE_ACTIONS = Object.freeze(['save', 'unsave', 'tag']);
export const TAG_VALUES = Object.freeze([null, 'learning', 'learned']);

/**
 * Decide the event an action produces from the current state.
 *
 * @param {import('../repositories/progress.repository.js').SaveState} current
 * @param {'save'|'unsave'|'tag'} action
 * @param {null|'learning'|'learned'} [tag]
 * @returns {{ eventType: string, eventValue: string|null, next: string } | null} null for a no-op
 */
export function decideTransition(current, action, tag = null) {
  if (action === 'save') {
    return current === 'unsaved' ? { eventType: 'save', eventValue: null, next: 'saved' } : null;
  }
  if (action === 'unsave') {
    return current === 'unsaved' ? null : { eventType: 'unsave', eventValue: null, next: 'unsaved' };
  }
  if (current === 'unsaved') {
    throw AppError.conflict('Save this before choosing a tag.');
  }
  const next = tag ?? 'saved';
  return next === current ? null : { eventType: 'tag_change', eventValue: tag, next };
}

/**
 * The owner of a signed-out write: the account the `pa_uid` is bound to, if
 * any, else the `pa_uid` itself. FR-AUTH-03: the profile is created by the
 * first write, never a read.
 *
 * @param {string} anonymousId
 * @param {Date} now
 * @param {import('../repositories/transaction.js').Executor} tx
 * @returns {Promise<import('../repositories/progress.repository.js').Owner>}
 */
async function resolveAnonymousOwner(anonymousId, now, tx) {
  await touchAnonymousProfile(anonymousId, now, tx);
  const boundUserId = await findBoundUserId(anonymousId, tx);
  return boundUserId === null ? { anonymousId } : { userId: boundUserId };
}

/**
 * @param {object} dependencies
 * @param {import('../lib/idempotency-store.js').IdempotencyStore} dependencies.idempotencyStore
 * @param {() => Date} [dependencies.clock]
 */
export function createSaveStateService({ idempotencyStore, clock = () => new Date() }) {
  /**
   * @param {object} request
   * @param {string} request.anonymousId the viewer's `pa_uid`
   * @param {number|null} [request.userId] the signed-in user, who owns the write
   *   outright; otherwise the `pa_uid` owns it, through its binding if any (§5.2)
   * @param {'word'|'phoneme'} request.targetKind
   * @param {number} request.targetId
   * @param {'save'|'unsave'|'tag'} request.action
   * @param {null|'learning'|'learned'} [request.tag]
   * @param {string} request.idempotencyKey
   * @returns {Promise<{ targetKind: string, targetId: number, state: string, replayed: boolean }>}
   */
  async function applySaveAction({ anonymousId, userId = null, targetKind, targetId, action, tag = null, idempotencyKey }) {
    // Keyed per identity, so one viewer's key can never replay another's result.
    const reservationKey = `save:${userId === null ? anonymousId : `user:${userId}`}:${idempotencyKey}`;
    const reservation = await idempotencyStore.reserve(reservationKey);
    if (reservation.status === 'completed') {
      return { ...reservation.result, replayed: true };
    }
    if (reservation.status === 'pending') {
      throw AppError.conflict('That change is already being saved.');
    }

    try {
      const outcome = await withTransaction(async (tx) => {
        if (!(await targetExists(targetKind, targetId, tx))) {
          throw AppError.notFound('That word or sound does not exist.');
        }

        const now = clock();
        const owner = userId !== null ? { userId } : await resolveAnonymousOwner(anonymousId, now, tx);

        const current = await lockTargetState(owner, targetKind, targetId, tx);
        const transition = decideTransition(current, action, tag);
        if (!transition) return { targetKind, targetId, state: current };

        const eventId = await insertActivityEvent(
          {
            owner,
            targetKind,
            targetId,
            eventType: transition.eventType,
            eventValue: transition.eventValue,
            occurredAt: now,
          },
          tx,
        );
        await upsertTargetState(
          { owner, targetKind, targetId, state: transition.next, lastEventId: eventId, updatedAt: now },
          tx,
        );
        return { targetKind, targetId, state: transition.next };
      });

      await idempotencyStore.complete(reservationKey, outcome);
      return { ...outcome, replayed: false };
    } catch (error) {
      // A failed write must not suppress a genuine retry (SDD §5.2).
      await idempotencyStore.release(reservationKey);
      throw error;
    }
  }

  return { applySaveAction };
}
