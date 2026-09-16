/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The FR-SAVE-02 state machine and the save/hydration input contract.
 */

import { describe, expect, it } from '@jest/globals';

import { createInMemoryIdempotencyStore } from '../../src/lib/idempotency-store.js';
import { decideTransition } from '../../src/services/save-state.service.js';
import { parseSaveRequest, parseViewerStateQuery } from '../../src/validators/progress.validator.js';

describe('decideTransition (FR-SAVE-02)', () => {
  it('saves from unsaved and ignores a repeated save', () => {
    expect(decideTransition('unsaved', 'save')).toEqual({ eventType: 'save', eventValue: null, next: 'saved' });
    expect(decideTransition('learning', 'save')).toBeNull();
  });

  it('unsaves from any saved state and ignores an unsave of nothing', () => {
    for (const state of ['saved', 'learning', 'learned']) {
      expect(decideTransition(state, 'unsave')).toEqual({ eventType: 'unsave', eventValue: null, next: 'unsaved' });
    }
    expect(decideTransition('unsaved', 'unsave')).toBeNull();
  });

  it('tags a saved target, resets with a null tag, and ignores a tag it already has', () => {
    expect(decideTransition('saved', 'tag', 'learned')).toEqual({ eventType: 'tag_change', eventValue: 'learned', next: 'learned' });
    expect(decideTransition('learned', 'tag', null)).toEqual({ eventType: 'tag_change', eventValue: null, next: 'saved' });
    expect(decideTransition('learning', 'tag', 'learning')).toBeNull();
    expect(decideTransition('saved', 'tag', null)).toBeNull();
  });

  it('refuses to tag an unsaved target', () => {
    expect(() => decideTransition('unsaved', 'tag', 'learned')).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe('parseSaveRequest', () => {
  const key = 'abcdefghijklmnopqrstuv';

  it('accepts a save and maps the tag choice `none` to null', () => {
    expect(parseSaveRequest({ action: 'save', targetKind: 'word', targetId: '12', idempotencyKey: key })).toEqual({
      action: 'save',
      targetKind: 'word',
      targetId: 12,
      tag: null,
      idempotencyKey: key,
    });
    expect(parseSaveRequest({ action: 'tag', targetKind: 'phoneme', targetId: 3, tag: 'none', idempotencyKey: key }).tag).toBeNull();
  });

  it('rejects an unknown action, target kind, tag or malformed key', () => {
    const base = { action: 'save', targetKind: 'word', targetId: 1, idempotencyKey: key };
    expect(() => parseSaveRequest({ ...base, action: 'delete' })).toThrow();
    expect(() => parseSaveRequest({ ...base, targetKind: 'user' })).toThrow();
    expect(() => parseSaveRequest({ ...base, action: 'tag', tag: 'mastered' })).toThrow();
    expect(() => parseSaveRequest({ ...base, idempotencyKey: 'short' })).toThrow();
    expect(() => parseSaveRequest({ ...base, targetId: -1 })).toThrow();
  });
});

describe('parseViewerStateQuery', () => {
  it('parses and de-duplicates id lists', () => {
    expect(parseViewerStateQuery({ variant: 'en-us', words: '4,4,9', phonemes: '' })).toEqual({
      variantCode: 'en-us',
      wordIds: [4, 9],
      phonemeIds: [],
    });
  });

  it('rejects non-integer ids and oversized lists', () => {
    expect(() => parseViewerStateQuery({ variant: 'en-us', words: '1,x' })).toThrow();
    const many = Array.from({ length: 201 }, (_, i) => i + 1).join(',');
    expect(() => parseViewerStateQuery({ variant: 'en-us', phonemes: many })).toThrow();
  });
});

describe('in-memory idempotency store', () => {
  it('reserves, blocks a concurrent duplicate, replays after completion, and expires', async () => {
    let clock = 0;
    const store = createInMemoryIdempotencyStore({ now: () => clock });
    expect(await store.reserve('k')).toEqual({ status: 'reserved' });
    expect(await store.reserve('k')).toEqual({ status: 'pending' });
    await store.complete('k', { state: 'saved' });
    expect(await store.reserve('k')).toEqual({ status: 'completed', result: { state: 'saved' } });
    clock += 31_000;
    expect(await store.reserve('k')).toEqual({ status: 'reserved' });
  });

  it('releases a reservation so a genuine retry proceeds', async () => {
    const store = createInMemoryIdempotencyStore();
    await store.reserve('k');
    await store.release('k');
    expect(await store.reserve('k')).toEqual({ status: 'reserved' });
  });
});
