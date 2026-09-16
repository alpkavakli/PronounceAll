/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The pure half of FR-SAVE-04 reconciliation: replaying events into state and
 * comparing it with the live rows.
 */

import { describe, expect, it } from '@jest/globals';

import { deriveExpectedStates, diffStates } from '../../src/services/state-reconciliation.service.js';

const event = (eventId, eventType, eventValue = null, targetKind = 'word', targetId = 7) => ({
  eventId,
  targetKind,
  targetId,
  eventType,
  eventValue,
});

describe('deriveExpectedStates', () => {
  it('replays FR-SAVE-02 in order: the FR-SAVE-04 acceptance sequence derives learning', () => {
    const expected = deriveExpectedStates([
      event(1, 'save'),
      event(2, 'tag_change', 'learning'),
      event(3, 'tag_change', 'learned'),
      event(4, 'tag_change', 'learning'),
    ]);
    expect(expected.get('word:7')).toEqual({ targetKind: 'word', targetId: 7, state: 'learning', lastEventId: 4 });
  });

  it('a null tag resets to saved, and unsave derives unsaved', () => {
    expect(deriveExpectedStates([event(1, 'save'), event(2, 'tag_change', 'learned'), event(3, 'tag_change')]).get('word:7').state).toBe('saved');
    expect(deriveExpectedStates([event(1, 'save'), event(2, 'unsave')]).get('word:7')).toMatchObject({ state: 'unsaved', lastEventId: 2 });
  });

  it('ignores listen, practice and encounter events entirely', () => {
    const expected = deriveExpectedStates([
      event(1, 'save'),
      event(2, 'audio_listen_word'),
      event(3, 'practice_attempt', '5'),
      event(4, 'word_encounter'),
      event(5, 'audio_listen_phoneme', null, 'phoneme', 9),
    ]);
    expect(expected.get('word:7')).toMatchObject({ state: 'saved', lastEventId: 1 });
    expect(expected.has('phoneme:9')).toBe(false);
  });

  it('keeps targets apart', () => {
    const expected = deriveExpectedStates([event(1, 'save', null, 'word', 1), event(2, 'save', null, 'phoneme', 1)]);
    expect([...expected.keys()].sort()).toEqual(['phoneme:1', 'word:1']);
  });
});

describe('diffStates', () => {
  const expected = deriveExpectedStates([event(1, 'save'), event(2, 'tag_change', 'learned')]);

  it('finds nothing when live matches', () => {
    expect(diffStates(expected, [{ targetKind: 'word', targetId: 7, state: 'learned', lastEventId: 2 }])).toEqual([]);
  });

  it('reports a wrong state, a stale event id, a missing row and an unexplained row', () => {
    expect(diffStates(expected, [{ targetKind: 'word', targetId: 7, state: 'saved', lastEventId: 2 }])[0].kind).toBe('mismatch');
    expect(diffStates(expected, [{ targetKind: 'word', targetId: 7, state: 'learned', lastEventId: 1 }])[0].kind).toBe('mismatch');
    expect(diffStates(expected, [])[0].kind).toBe('missing');
    const unexplained = diffStates(new Map(), [{ targetKind: 'word', targetId: 7, state: 'saved', lastEventId: 1 }]);
    expect(unexplained).toEqual([
      { kind: 'unexplained', targetKind: 'word', targetId: 7, live: { targetKind: 'word', targetId: 7, state: 'saved', lastEventId: 1 } },
    ]);
  });
});
