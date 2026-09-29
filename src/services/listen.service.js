/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Audio-listen events (FR-SAVE-09, SRS 1.0.5).
 *
 * One genuine playback start by an eligible actor is one `audio_listen_word` or
 * `audio_listen_phoneme` event, appended to the log and nothing else:
 *
 *   - eligible: a registered user, or an anonymous actor that ALREADY has a
 *     progress profile. A passive visitor's playback records nothing and never
 *     creates a profile — the request is a successful no-op, so playback is
 *     never blocked;
 *   - derived save state is never touched (FR-SAVE-04);
 *   - repeated listens are not deduplicated: each is a real playback.
 */

import { AppError } from '../errors/index.js';
import {
  anonymousProfileExists,
  findBoundUserId,
  insertActivityEvent,
  targetExists,
} from '../repositories/progress.repository.js';

const EVENT_TYPE = Object.freeze({ word: 'audio_listen_word', phoneme: 'audio_listen_phoneme' });

/**
 * @param {object} listen
 * @param {string|null} listen.anonymousId the viewer's `pa_uid`
 * @param {number|null} [listen.userId] the signed-in user, always eligible
 * @param {'word'|'phoneme'} listen.targetKind
 * @param {number} listen.targetId
 * @param {() => Date} [clock]
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordListen({ anonymousId, userId = null, targetKind, targetId }, clock = () => new Date()) {
  if (!(await targetExists(targetKind, targetId))) {
    throw AppError.notFound('That word or sound does not exist.');
  }
  if (userId === null && (!anonymousId || !(await anonymousProfileExists(anonymousId)))) {
    return { recorded: false };
  }

  const ownerUserId = userId ?? (await findBoundUserId(anonymousId));
  await insertActivityEvent({
    owner: ownerUserId === null ? { anonymousId } : { userId: ownerUserId },
    targetKind,
    targetId,
    eventType: EVENT_TYPE[targetKind],
    eventValue: null,
    occurredAt: clock(),
  });
  return { recorded: true };
}
