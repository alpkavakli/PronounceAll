/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The content-addressing and asset-key invariants (V4, C6, FR-CONTENT-04).
 *
 * These are the properties the audio pipeline RELIES on before a single byte of
 * audio exists: that a key is derived from content and not from a name, that a
 * malformed key cannot escape the storage root, that an empty payload is
 * refused rather than stored, and that two teaching units can never collide on
 * one asset key. The last one is not hypothetical — `d` and `ð` shared an asset
 * row until V5 fixed the collation, which is why the symbol cases are here.
 */

import { describe, expect, test } from '@jest/globals';

import { digest, resolvePath, storageKeyFor, store } from '../../src/lib/audio-storage.js';
import { ASSET_KIND, GENERATOR_VERSION, PIPER_VOICE, assetKeyFor } from '../../src/services/audio-asset.service.js';

const OGG = 'audio/ogg';

describe('content addressing (V4)', () => {
  test('the storage key is derived from the bytes, sharded by the digest prefix', () => {
    const bytes = Buffer.from('some audio payload');
    const sha = digest(bytes);

    expect(storageKeyFor(bytes, OGG)).toBe(`${sha.slice(0, 2)}/${sha}.ogg`);
  });

  test('identical bytes give an identical key, so a re-run converges', () => {
    const first = storageKeyFor(Buffer.from('same'), OGG);
    const second = storageKeyFor(Buffer.from('same'), OGG);

    expect(first).toBe(second);
  });

  test('different bytes give a different key, so a regenerated asset is a new file', () => {
    expect(storageKeyFor(Buffer.from('one'), OGG)).not.toBe(storageKeyFor(Buffer.from('two'), OGG));
  });

  test('an unsupported MIME type is refused rather than given an invented extension', () => {
    expect(() => storageKeyFor(Buffer.from('x'), 'audio/aiff')).toThrow(/Unsupported audio MIME type/);
  });
});

describe('resolvePath traversal guard', () => {
  test('a well-formed key resolves', () => {
    const key = storageKeyFor(Buffer.from('payload'), OGG);

    expect(() => resolvePath(key)).not.toThrow();
  });

  test.each([
    ['../../etc/passwd'],
    ['ab/../../../etc/passwd.ogg'],
    ['ab/not-a-digest.ogg'],
    ['ab/abc.ogg'],
    [''],
  ])('a malformed key is refused: %s', (key) => {
    expect(() => resolvePath(key)).toThrow(/Malformed storage key/);
  });
});

describe('store refuses what FR-CONTENT-04 forbids', () => {
  test('an empty payload is never stored', async () => {
    await expect(store(Buffer.alloc(0), OGG)).rejects.toThrow(/empty audio payload/);
  });

  test('a non-Buffer payload is never stored', async () => {
    await expect(store('not bytes', OGG)).rejects.toThrow(/empty audio payload/);
  });
});

describe('assetKeyFor (C6 deterministic keys)', () => {
  test('a generated key carries the voice and generator version', () => {
    const key = assetKeyFor({
      kind: ASSET_KIND.PHONEME,
      variantCode: 'en-us',
      target: 'p',
      sourceKind: 'tts_piper',
    });

    expect(key).toBe(`phoneme:en-us:p:tts_piper:${PIPER_VOICE}:${GENERATOR_VERSION}`);
  });

  test('a human recording is identified without a voice or version', () => {
    const key = assetKeyFor({
      kind: ASSET_KIND.WORD,
      variantCode: 'en-us',
      target: 'cupcake',
      sourceKind: 'wiktionary_human',
    });

    expect(key).toBe('word:en-us:cupcake:wiktionary_human');
  });

  test('the source kind participates, so the same target under two sources is two assets', () => {
    const piper = assetKeyFor({ kind: ASSET_KIND.WORD, variantCode: 'en-us', target: 'cupcake', sourceKind: 'tts_piper' });
    const human = assetKeyFor({ kind: ASSET_KIND.WORD, variantCode: 'en-us', target: 'cupcake', sourceKind: 'wiktionary_human' });

    expect(piper).not.toBe(human);
  });

  test('accent-distinguished symbols do not collide (the V5 regression)', () => {
    const d = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-us', target: 'd', sourceKind: 'tts_piper' });
    const eth = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-us', target: 'ð', sourceKind: 'tts_piper' });

    expect(d).not.toBe(eth);
  });

  test('the variant participates, so two variants never share one recording', () => {
    const us = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-us', target: 'p', sourceKind: 'tts_piper' });
    const gb = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-gb', target: 'p', sourceKind: 'tts_piper' });

    expect(us).not.toBe(gb);
  });

  test('a Commons human recording carries no synthesiser identity', () => {
    // The key would otherwise claim a Piper voice and generator version
    // produced a recording made by a person.
    const key = assetKeyFor({
      kind: ASSET_KIND.PHONEME,
      variantCode: 'en-us',
      target: 't',
      sourceKind: 'commons_human',
    });

    expect(key).toBe('phoneme:en-us:t:commons_human');
    expect(key).not.toContain(PIPER_VOICE);
    expect(key).not.toContain(GENERATOR_VERSION);
  });

  test('the two human sources are distinct assets for the same unit', () => {
    const commons = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-us', target: 't', sourceKind: 'commons_human' });
    const wiktionary = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-us', target: 't', sourceKind: 'wiktionary_human' });

    expect(commons).not.toBe(wiktionary);
  });

  test('a discriminated candidate target is its own asset', () => {
    const production = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-us', target: 'w', sourceKind: 'tts_piper' });
    const candidate = assetKeyFor({ kind: ASSET_KIND.PHONEME, variantCode: 'en-us', target: 'w#3', sourceKind: 'tts_piper' });

    expect(candidate).not.toBe(production);
    expect(candidate).toContain('w#3');
  });

  test('an unknown asset kind is refused', () => {
    expect(() =>
      assetKeyFor({ kind: 'sentence', variantCode: 'en-us', target: 'p', sourceKind: 'tts_piper' }),
    ).toThrow(/Unknown audio asset kind/);
  });
});
