/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Which layer decides a stored syllable breakdown (FR-WORD-03, D4 §5.6).
 *
 * The persistence step writes what a learner reads, so the precedence is the
 * contract: a source separator, then maintainer curation, then a hold on
 * proven source defects, then a reviewed override, then the algorithm. Each
 * test pins one layer winning over the one below it.
 */

import { describe, expect, it } from '@jest/globals';

import { applyProposedDivision, planSyllableBreakdown } from '../../src/services/syllabification.service.js';
import { deriveSyllableBreakdown } from '../../src/services/word-ingestion.service.js';

const C = (ipaSymbol) => ({ ipaSymbol, category: 'consonant' });
const V = (ipaSymbol) => ({ ipaSymbol, category: 'vowel' });
const D = (ipaSymbol) => ({ ipaSymbol, category: 'diphthong' });

// basement /ˈbeɪsmənt/
const BASEMENT = [C('b'), D('eɪ'), C('s'), C('m'), V('ə'), C('n'), C('t')];
// darling /ˈdɑɹlɪŋ/
const DARLING = [C('d'), V('ɑ'), C('ɹ'), C('l'), V('ɪ'), C('ŋ')];
// replacement /ɹɪˈpleɪsmənt/
const REPLACEMENT = [C('ɹ'), V('ɪ'), C('p'), C('l'), D('eɪ'), C('s'), C('m'), V('ə'), C('n'), C('t')];

const plan = (transcription, units, extra = {}) =>
  planSyllableBreakdown({
    transcription,
    storedBreakdown: deriveSyllableBreakdown(transcription),
    derivedBreakdown: deriveSyllableBreakdown(transcription),
    units,
    toBreakdown: deriveSyllableBreakdown,
    ...extra,
  });

describe('applyProposedDivision', () => {
  it('applies a reviewed division and keeps the source stress marks', () => {
    expect(applyProposedDivision('ˈbeɪsmənt', BASEMENT, 'beɪs.mənt')).toBe('ˈbeɪs.mənt');
    expect(applyProposedDivision('ɹɪˈpleɪsmənt', REPLACEMENT, 'ɹɪ.pleɪs.mənt')).toBe('ɹɪˈpleɪs.mənt');
  });

  it('refuses a proposal that contradicts a source stress mark', () => {
    // The source says the syllable begins at /p/; the proposal begins it at /l/.
    expect(applyProposedDivision('ɹɪˈpleɪsmənt', REPLACEMENT, 'ɹɪp.leɪs.mənt')).toBeNull();
  });

  it('refuses a proposal that spells different units', () => {
    expect(applyProposedDivision('ˈbeɪsmənt', BASEMENT, 'beɪz.mənt')).toBeNull();
    expect(applyProposedDivision('ˈbeɪsmənt', BASEMENT, 'beɪs.mən')).toBeNull();
  });
});

describe('planSyllableBreakdown — precedence', () => {
  it('leaves a transcription the source already divided', () => {
    const result = plan('ˈmɛʒ.ɚ', [C('m'), V('ɛ'), C('ʒ'), V('ɚ')]);
    expect(result).toEqual({ source: 'source', breakdown: 'ˈmɛʒ·ɚ' });
  });

  it('keeps a maintainer-curated breakdown over the algorithm', () => {
    const result = plan('ˈdɑɹlɪŋ', DARLING, { storedBreakdown: 'ˈdɑ·ɹlɪŋ' });
    expect(result).toEqual({ source: 'curated', breakdown: 'ˈdɑ·ɹlɪŋ' });
  });

  it('holds a proven source defect at the seeded breakdown', () => {
    const result = plan('ˈdɑɹlɪŋ', DARLING, { sourceDefect: true });
    expect(result).toEqual({ source: 'held-defect', breakdown: 'ˈdɑɹlɪŋ' });
  });

  it('applies a reviewed override instead of the algorithm', () => {
    const result = plan('ˈbeɪsmənt', BASEMENT, {
      override: { reviewStatus: 'adopt-reference', proposedBreakdown: 'beɪs.mənt' },
    });
    expect(result).toEqual({ source: 'override', breakdown: 'ˈbeɪs·mənt' });
  });

  it('writes no computed boundary for an unreviewed override row', () => {
    const result = plan('ˈbeɪsmənt', BASEMENT, {
      override: { reviewStatus: 'ambiguous', proposedBreakdown: null },
    });
    expect(result).toEqual({ source: 'override-unreviewed', breakdown: 'ˈbeɪsmənt' });
  });

  it('writes nothing when a reviewed proposal is refused', () => {
    const result = plan('ˈbeɪsmənt', BASEMENT, {
      override: { reviewStatus: 'adopt-reference', proposedBreakdown: 'beɪz.mənt' },
    });
    expect(result).toEqual({ source: 'override-refused', breakdown: 'ˈbeɪsmənt' });
  });

  it('infers the division otherwise, in the stored breakdown format', () => {
    expect(plan('ˈdɑɹlɪŋ', DARLING)).toEqual({ source: 'inferred', breakdown: 'ˈdɑɹ·lɪŋ' });
  });

  it('is idempotent: a breakdown it already wrote is planned unchanged', () => {
    const result = plan('ˈdɑɹlɪŋ', DARLING, { storedBreakdown: 'ˈdɑɹ·lɪŋ' });
    expect(result).toEqual({ source: 'inferred', breakdown: 'ˈdɑɹ·lɪŋ' });
  });
});
