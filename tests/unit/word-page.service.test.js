/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Interleaving the permitted transcription marks (FR-IPA-01, D4 §3.8).
 *
 * `pronunciation_phonemes` stores only the clickable units, so `/ˈoʊ.pən/`
 * would otherwise render as `oʊpən` and lose the stress and syllable notation
 * FR-WORD-03 and D4 both require to be shown.
 *
 * The composer walks a decided unit sequence; it never identifies a symbol and
 * never consults the inventory. These tests pin that boundary: anything that
 * does not align EXACTLY returns null so the caller renders the plain sequence,
 * because a silently dropped or invented mark is worse than no mark at all.
 */

import { describe, expect, it } from '@jest/globals';

import { composeTranscriptionSegments } from '../../src/services/word-page.service.js';

const units = (...symbols) => symbols.map((ipaSymbol, index) => ({ ipaSymbol, phonemeId: index + 1 }));
const render = (segments) =>
  segments === null ? null : segments.map((s) => (s.type === 'mark' ? s.text : s.occurrence.ipaSymbol)).join('');

describe('composeTranscriptionSegments', () => {
  it('puts primary stress back in front of the unit it belongs to', () => {
    const segments = composeTranscriptionSegments('ˈdɑɹlɪŋ', units('d', 'ɑ', 'ɹ', 'l', 'ɪ', 'ŋ'));

    expect(render(segments)).toBe('ˈdɑɹlɪŋ');
    expect(segments[0]).toEqual({ type: 'mark', text: 'ˈ' });
    expect(segments[1].type).toBe('phoneme');
  });

  it('keeps stress and the syllable separator together', () => {
    const segments = composeTranscriptionSegments('ˈoʊ.pən', units('oʊ', 'p', 'ə', 'n'));

    expect(render(segments)).toBe('ˈoʊ.pən');
    expect(segments.filter((s) => s.type === 'mark').map((s) => s.text)).toEqual(['ˈ', '.']);
    // Only the four canonical units stay clickable; marks never become buttons.
    expect(segments.filter((s) => s.type === 'phoneme')).toHaveLength(4);
  });

  it('matches multi-character units rather than their first character', () => {
    const segments = composeTranscriptionSegments('ˈtʃeɪnd͡ʒ'.replace('d͡ʒ', 'dʒ'), units('tʃ', 'eɪ', 'n', 'dʒ'));

    expect(render(segments)).toBe('ˈtʃeɪndʒ');
    expect(segments.filter((s) => s.type === 'phoneme').map((s) => s.occurrence.ipaSymbol)).toEqual([
      'tʃ',
      'eɪ',
      'n',
      'dʒ',
    ]);
  });

  it('accepts secondary stress', () => {
    expect(render(composeTranscriptionSegments('ˌɑnˈsɛt', units('ɑ', 'n', 's', 'ɛ', 't')))).toBe('ˌɑnˈsɛt');
  });

  it('returns null for a character that is neither a unit nor a permitted mark', () => {
    // `ː` is not canonical (D4 §3.7). Rendering it would contradict the frozen
    // convention, so the attempt is abandoned rather than the mark dropped.
    expect(composeTranscriptionSegments('ˈdɑːɹlɪŋ', units('d', 'ɑ', 'ɹ', 'l', 'ɪ', 'ŋ'))).toBeNull();
  });

  it('returns null when the transcription and the stored units disagree', () => {
    expect(composeTranscriptionSegments('ˈoʊpən', units('oʊ', 'p', 'ə', 'n', 'z'))).toBeNull();
    expect(composeTranscriptionSegments('ˈoʊpənz', units('oʊ', 'p', 'ə', 'n'))).toBeNull();
  });

  it('returns null rather than guessing when there is nothing to align', () => {
    expect(composeTranscriptionSegments('', units('d'))).toBeNull();
    expect(composeTranscriptionSegments('ˈdɑɹ', [])).toBeNull();
    expect(composeTranscriptionSegments(null, units('d'))).toBeNull();
  });
});
