/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Seed pipeline stages 2-4: NORMALISE, VALIDATE, LOAD (decision E1,
 * FR-CONTENT-01, FR-WORD-03, FR-WORD-10).
 *
 * E1 puts the reusable normalise, validate, and load logic in `services/` and
 * the one-off import entry point in `scripts/`, so the pipeline follows the C4
 * "one implementation, several entry points" rule rather than growing a second
 * copy of the rules inside a script. The fetch stage is `scripts/fetch-
 * wiktionary.js` and is the only stage that touches the network.
 *
 * Everything here is variant-parameterised: the variant is a DATA dimension
 * threaded through as a column, never a code branch (E1), which is what makes
 * FR-WORD-10's "adding a variant is a row plus a content batch" true.
 *
 * The loader upserts on natural keys, so a re-run CONVERGES rather than
 * duplicating — the idempotency rule of C6 and the reproducibility criterion of
 * FR-CONTENT-01.
 */

import { AppError } from '../errors/index.js';
import {
  deletePronunciationByIpa,
  findPronunciationsByWordId,
  upsertPronunciation,
  upsertWord,
} from '../repositories/words.repository.js';
import { withTransaction } from '../repositories/transaction.js';
import { canonicaliseSlug } from '../validators/word-slug.validator.js';

/** The IPA stress markers FR-WORD-03 names. */
const PRIMARY_STRESS = 'ˈ';
const SECONDARY_STRESS = 'ˌ';

/** The separator between syllables in the displayed breakdown. */
const SYLLABLE_SEPARATOR = '·';

/**
 * Above this many surviving candidates the accent tags have not narrowed the
 * entry to American English, and the word is held back for curation rather than
 * loaded speculatively. Four covers a genuine heteronym with two pronunciations
 * each; beyond that the entry is listing accents, not variants.
 */
const MAX_PRONUNCIATIONS_PER_WORD = 4;

/**
 * Accent labels that mark a transcription as American, and labels that rule one
 * out. Wiktionary tags pronunciations by accent, and an `en-us` dictionary that
 * took the first transcription on the page would ship the British one for any
 * word where RP is listed first — `banana` is exactly that case.
 */
const AMERICAN_ACCENTS = new Set([
  'ga',
  'genam',
  'general american',
  'us',
  'usa',
  'america',
  'american',
  'ame',
]);

/**
 * Labels that describe variation WITHIN American English rather than another
 * country's accent. A transcription carrying only these is still American:
 * `water` is tagged by the cot-caught merger and never by `GA` at all.
 */
const AMERICAN_INTERNAL_QUALIFIERS = new Set([
  'cot-caught',
  'non-cot-caught',
  'weak vowel',
  'weak vowel merger',
  'father-bother',
  'mary-marry-merry',
  'pin-pen',
  'wine-whine',
  'horse-hoarse',
  'general',
]);

/**
 * Labels that are not accents at all: part of speech, prosodic form, and
 * register. Wiktionary puts them in the same `a=` slot, and reading them as
 * accents makes an entry look untagged-by-nobody — `address` carries only
 * `noun` and `verb`, and `because` only `strong form` and `weak form`, so both
 * would otherwise yield no American transcription at all.
 */
const NON_ACCENT_QUALIFIERS = new Set([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'weak form',
  'strong form',
  'stressed',
  'unstressed',
  'obsolete',
  'archaic',
  'dated',
  'rare',
  'nonstandard',
  'proscribed',
  'informal',
  'formal',
  'careful speech',
  'rapid speech',
]);

/**
 * @param {string[]} accents
 * @returns {string[]} only the labels that actually describe an accent
 */
function accentLabelsOnly(accents) {
  return accents.filter((accent) => !NON_ACCENT_QUALIFIERS.has(accent.toLowerCase()));
}

/**
 * @param {string[]} accents
 * @returns {boolean}
 */
function isExplicitlyAmerican(accents) {
  return accents.some((accent) => AMERICAN_ACCENTS.has(accent.toLowerCase()));
}

/**
 * @param {string[]} accents
 * @returns {boolean}
 */
function isAmericanInternalOnly(accents) {
  return (
    accents.length > 0 &&
    accents.every((accent) => AMERICAN_INTERNAL_QUALIFIERS.has(accent.toLowerCase()))
  );
}

/**
 * Choose the American transcriptions from an entry's candidates, in a fixed
 * order of preference so the pipeline is deterministic (FR-CONTENT-01).
 *
 * @param {Array<{ ipa: string, accents: string[] }>} candidates
 * @returns {Array<{ ipa: string, accents: string[] }>}
 */
export function selectAmericanTranscriptions(candidates) {
  const tagged = candidates.map((candidate) => ({
    ...candidate,
    accents: accentLabelsOnly(candidate.accents),
  }));

  const explicit = tagged.filter((candidate) => isExplicitlyAmerican(candidate.accents));
  if (explicit.length > 0) {
    return explicit;
  }

  // An untagged transcription is the entry's general form. Wiktionary leaves it
  // untagged when the word is pronounced alike across accents — `cupcake`.
  const untagged = tagged.filter((candidate) => candidate.accents.length === 0);
  if (untagged.length > 0) {
    return untagged;
  }

  return tagged.filter((candidate) => isAmericanInternalOnly(candidate.accents));
}

/**
 * Reject a candidate that is not a complete transcription of the headword.
 *
 * Wiktionary abbreviates a variant that differs only in its ending by writing
 * the changed fragment alone — `/ˈleɪŋ-/` under `language`, `/-əŋʒ/` under
 * `orange`. Loading one would put a fragment on a word page as if it were the
 * whole pronunciation.
 *
 * @param {string} ipa a normalised transcription
 * @returns {boolean}
 */
function isCompleteTranscription(ipa) {
  return ipa !== '' && !ipa.includes('-');
}

/**
 * Strip the phonemic slashes and any stray upstream punctuation.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normaliseIpa(raw) {
  return raw
    .trim()
    .replace(/^\/+|\/+$/g, '')
    // NFC per FR-IPA-01's normalisation convention, so a composed and a
    // decomposed transcription cannot both occupy the natural key.
    .normalize('NFC')
    .trim();
}

/**
 * Derive the written syllable and stress breakdown from a transcription
 * (FR-WORD-03).
 *
 * Boundaries come from two sources, BOTH of which are supplied by the upstream
 * transcription itself:
 *
 *   - an explicit `.` syllable separator, which Wiktionary writes on many
 *     multi-syllable entries (`/ˈbɪz.nɪs/`);
 *   - a stress marker, which by IPA convention is syllable-initial, so `ˈ` and
 *     `ˌ` each open a syllable (`/bəˈnænə/` breaks before `ˈ`).
 *
 * Nothing here infers a boundary the source did not mark. That is deliberate:
 * inferring one would need a vowel-nucleus table, which means an en-US phoneme
 * inventory — and that inventory is the canonical artifact owned by Iteration 2
 * (D-R3-07), not something this iteration may invent. The consequence is that a
 * transcription upstream leaves unmarked yields a COARSE breakdown rather than
 * a wrong one, and `validateEntry` reports every such case against the upstream
 * hyphenation so the maintainer can supply an override in the curation file.
 *
 * @param {string} ipa a normalised transcription, without slashes
 * @returns {string}
 */
export function deriveSyllableBreakdown(ipa) {
  const units = [];

  for (const chunk of ipa.split('.')) {
    let current = '';
    for (const character of chunk) {
      if ((character === PRIMARY_STRESS || character === SECONDARY_STRESS) && current !== '') {
        units.push(current);
        current = character;
        continue;
      }
      current += character;
    }
    if (current !== '') {
      units.push(current);
    }
  }

  return units.filter((unit) => unit.trim() !== '').join(SYLLABLE_SEPARATOR);
}

/**
 * @param {string} breakdown
 * @returns {number}
 */
function syllableCount(breakdown) {
  return breakdown.split(SYLLABLE_SEPARATOR).filter((unit) => unit.trim() !== '').length;
}

/**
 * NORMALISE — turn one raw artifact entry into the rows the schema holds.
 *
 * @param {object} entry a raw entry from the fetch artifact
 * @param {object} [curation] per-word maintainer overrides
 * @returns {object} a normalised entry, possibly carrying `rejections`
 */
export function normaliseEntry(entry, curation = {}) {
  const rejections = [];
  const warnings = [];

  const normalizedHeadword = canonicaliseSlug(entry.headword);

  if (entry.error) {
    rejections.push(`upstream: ${entry.error}`);
  }

  // A curated `ipa` list pins the American transcriptions for a word whose
  // upstream accent tags do not narrow it — the reviewed decision replaces the
  // selector rather than being merged with it, and its order is the display
  // order. Every pinned form must actually appear upstream, so curation cannot
  // silently invent a pronunciation.
  const pinned = curation.ipa;
  let selected;

  if (Array.isArray(pinned)) {
    const available = new Map(
      (entry.transcriptions ?? []).map((candidate) => [normaliseIpa(candidate.ipa), candidate]),
    );
    selected = [];
    for (const wanted of pinned) {
      const candidate = available.get(normaliseIpa(wanted));
      if (!candidate) {
        rejections.push(`curated transcription ${wanted} is not present upstream`);
        continue;
      }
      selected.push({ ...candidate, accents: [] });
    }
  } else {
    selected = selectAmericanTranscriptions(entry.transcriptions ?? []);
  }

  if (selected.length === 0) {
    rejections.push('no American transcription could be identified');
  }

  // Deduplicate on the natural key `(word_id, ipa_transcription)`: a heteronym
  // listing the same transcription under two etymologies must not attempt two
  // rows that collide.
  const seen = new Set();
  const deduped = [];
  for (const candidate of selected) {
    const ipa = normaliseIpa(candidate.ipa);
    if (seen.has(ipa) || !isCompleteTranscription(ipa)) {
      continue;
    }
    // Drop an individual transcription that cannot satisfy FR-WORD-03's stress
    // criterion rather than failing the whole word on account of one bad
    // variant: `comfortable` lists two Indian-English forms with no stress mark
    // alongside four sound American ones.
    const provisional = deriveSyllableBreakdown(ipa);
    if (syllableCount(provisional) > 1 && !provisional.includes(PRIMARY_STRESS)) {
      warnings.push(`${ipa}: dropped, multi-syllable transcription carries no stress marker`);
      continue;
    }
    seen.add(ipa);
    deduped.push(ipa);
  }

  // Prefer a transcription that carries upstream syllable dots as the primary:
  // it yields a genuinely syllabified breakdown rather than a coarse one, and
  // the choice is deterministic. Order is otherwise upstream order.
  //
  // A curated list is left in the order the maintainer wrote it, since choosing
  // the primary is exactly the decision that curation was recording.
  const ordered = Array.isArray(pinned)
    ? deduped
    : [...deduped].sort((a, b) => {
        const dotted = Number(b.includes('.')) - Number(a.includes('.'));
        return dotted !== 0 ? dotted : deduped.indexOf(a) - deduped.indexOf(b);
      });

  const overrides = curation.pronunciations ?? {};

  const pronunciations = ordered.map((ipa, index) => {
    const override = overrides[ipa] ?? {};
    const breakdown = override.syllableBreakdown ?? deriveSyllableBreakdown(ipa);

    // The upstream hyphenation is the only independent syllable count
    // available. A disagreement is reported, never silently corrected.
    //
    // A curated override is exempt. The check exists to surface a breakdown
    // NOBODY has reviewed — one the upstream transcription left unsyllabified —
    // so once a maintainer has recorded the breakdown in the curation file the
    // check has already done its work. Exempting it also stops a true
    // pronunciation/spelling mismatch from reading as an outstanding defect:
    // hyphenation counts the SPELLING, so an elided form such as `ˈkæmɹə`
    // (`cam-er-a`) legitimately has fewer syllables than the hyphenation does.
    const hyphenated = entry.hyphenation?.length ?? 0;
    if (
      override.syllableBreakdown === undefined &&
      hyphenated > 1 &&
      syllableCount(breakdown) !== hyphenated
    ) {
      warnings.push(
        `${ipa}: breakdown has ${syllableCount(breakdown)} syllable(s), ` +
          `upstream hyphenation has ${hyphenated} (${entry.hyphenation.join('-')})`,
      );
    }

    return {
      ipaTranscription: ipa,
      syllableBreakdown: breakdown,
      gloss: override.gloss ?? null,
      // Exactly one primary, at the lowest display order, so the ordered read
      // of SDD §5.3 leads with it (E4, FR-WORD-03).
      isPrimary: index === 0,
      displayOrder: index,
    };
  });

  const meaning = curation.meaning ?? entry.definition;
  if (!meaning) {
    rejections.push('no meaning could be extracted');
  }

  return {
    variant: entry.variant,
    normalizedHeadword,
    displayHeadword: entry.headword,
    meaning,
    sourceUrl: entry.sourceUrl,
    sourceLicence: entry.sourceLicence,
    retrievedAt: entry.retrievedAt,
    pronunciations,
    rejections,
    warnings,
  };
}

/**
 * VALIDATE — the gate that decides whether an entry may load.
 *
 * These are the invariants the schema cannot express on its own. In particular
 * `UNIQUE (word_id, is_primary_flag)` enforces AT MOST one primary; only this
 * check enforces EXACTLY one, which is what FR-WORD-03 requires.
 *
 * @param {object} normalised
 * @returns {string[]} rejection reasons; empty means the entry may load
 */
export function validateEntry(normalised) {
  const problems = [...normalised.rejections];

  if (!normalised.normalizedHeadword) {
    problems.push('empty normalised headword');
  }

  if (!normalised.sourceUrl || !normalised.sourceLicence || !normalised.retrievedAt) {
    // FR-CONTENT-01/05 and NFR-LEGAL-05: attribution is not optional, and a
    // word that cannot be attributed cannot be published under CC BY-SA.
    problems.push('incomplete upstream attribution (source URL, licence, retrieval date)');
  }

  if (normalised.pronunciations.length === 0) {
    problems.push('no pronunciation rows');
  }

  // A word offering this many candidates has not been narrowed to American
  // English by its accent tags — `because` lists eighteen forms distinguished
  // only as strong and weak, several of them plainly British. Loading them all
  // would put non-American transcriptions on an `en-us` page, so the entry is
  // held back for a curation decision instead.
  if (normalised.pronunciations.length > MAX_PRONUNCIATIONS_PER_WORD) {
    problems.push(
      `${normalised.pronunciations.length} candidate pronunciations exceeds the ` +
        `${MAX_PRONUNCIATIONS_PER_WORD} the selector can choose between confidently; ` +
        'pin the American forms in the curation file',
    );
  }

  const primaries = normalised.pronunciations.filter((entry) => entry.isPrimary);
  if (primaries.length !== 1) {
    problems.push(`expected exactly one primary pronunciation, found ${primaries.length}`);
  }

  const orders = normalised.pronunciations.map((entry) => entry.displayOrder);
  const dense = orders.every((order, index) => order === index);
  if (!dense) {
    problems.push('display_order is not dense from zero');
  }

  if (primaries.length === 1 && primaries[0].displayOrder !== 0) {
    problems.push('the primary pronunciation is not first in display_order');
  }

  for (const pronunciation of normalised.pronunciations) {
    if (!pronunciation.ipaTranscription) {
      problems.push('empty IPA transcription');
    }
    if (!pronunciation.syllableBreakdown) {
      problems.push(`${pronunciation.ipaTranscription}: empty syllable breakdown`);
    }
    // FR-WORD-03's acceptance criterion: the breakdown identifies stress with
    // the standard markers. A multi-syllable word with no stress marker at all
    // has lost that information upstream.
    if (
      syllableCount(pronunciation.syllableBreakdown) > 1 &&
      !pronunciation.syllableBreakdown.includes(PRIMARY_STRESS)
    ) {
      problems.push(
        `${pronunciation.ipaTranscription}: multi-syllable breakdown carries no primary stress marker`,
      );
    }
  }

  return problems;
}

/**
 * LOAD — upsert one validated entry.
 *
 * The word and its pronunciations go in ONE transaction, because a word that
 * committed without its pronunciations would render a page that cannot satisfy
 * FR-WORD-03. The boundary is decided here, in the service that knows what must
 * be atomic, and executed by the data layer's runner (C4, §7.4).
 *
 * @param {object} normalised a validated entry
 * @param {number} variantId
 * @returns {Promise<{ wordId: number, removed: number }>}
 */
export async function loadEntry(normalised, variantId) {
  return withTransaction(async (tx) => {
    const wordId = await upsertWord(
      {
        variantId,
        normalizedHeadword: normalised.normalizedHeadword,
        displayHeadword: normalised.displayHeadword,
        meaning: normalised.meaning,
        sourceUrl: normalised.sourceUrl,
        sourceLicence: normalised.sourceLicence,
        retrievedAt: normalised.retrievedAt,
      },
      tx,
    );

    // Upsert before deleting: `UNIQUE (word_id, display_order)` and
    // `UNIQUE (word_id, is_primary_flag)` would collide mid-way if a re-run
    // reordered rows, so the whole set is rewritten inside one transaction
    // where the intermediate state is never visible.
    const existing = await findPronunciationsByWordId(wordId, tx);

    // Clear the ordering keys first, so no upsert below collides with a row
    // that has not been rewritten yet.
    for (const row of existing) {
      await upsertPronunciation(
        {
          wordId,
          ipaTranscription: row.ipaTranscription,
          syllableBreakdown: row.syllableBreakdown,
          gloss: row.gloss,
          isPrimary: false,
          displayOrder: -(row.pronunciationId % 30000) - 1,
        },
        tx,
      );
    }

    for (const pronunciation of normalised.pronunciations) {
      await upsertPronunciation({ ...pronunciation, wordId }, tx);
    }

    const keep = new Set(normalised.pronunciations.map((entry) => entry.ipaTranscription));
    let removed = 0;
    for (const row of existing) {
      if (!keep.has(row.ipaTranscription)) {
        removed += await deletePronunciationByIpa(wordId, row.ipaTranscription, tx);
      }
    }

    return { wordId, removed };
  });
}

/**
 * Run normalise, validate, and load over a whole artifact.
 *
 * @param {object} artifact the parsed fetch artifact
 * @param {object} options
 * @param {number} options.variantId
 * @param {Record<string, object>} [options.curation] per-headword overrides
 * @param {boolean} [options.dryRun] when true, validate and report but load
 *   nothing — the reviewable diff E1 asks the validate stage to produce
 * @returns {Promise<object>} a report
 */
export async function ingestArtifact(artifact, { variantId, curation = {}, dryRun = false }) {
  if (!Number.isInteger(variantId)) {
    throw AppError.internal(new Error('ingestArtifact requires a resolved variantId'));
  }

  const loaded = [];
  const rejected = [];
  const warned = [];

  for (const entry of artifact.entries) {
    const perWord = curation[entry.headword] ?? {};
    if (perWord.skip) {
      rejected.push({ headword: entry.headword, problems: [`skipped: ${perWord.skip}`] });
      continue;
    }

    const normalised = normaliseEntry(entry, perWord);
    const problems = validateEntry(normalised);

    if (problems.length > 0) {
      rejected.push({ headword: entry.headword, problems });
      continue;
    }

    if (normalised.warnings.length > 0) {
      warned.push({ headword: entry.headword, warnings: normalised.warnings });
    }

    if (!dryRun) {
      await loadEntry(normalised, variantId);
    }
    loaded.push({
      headword: entry.headword,
      pronunciations: normalised.pronunciations.length,
    });
  }

  return { loaded, rejected, warned, dryRun };
}
