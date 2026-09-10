/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Iteration 2 content pipeline (D4; decisions E1, E2, C6; FR-IPA-01/02/08,
 * FR-CONTENT-02).
 *
 * Three operations, deliberately separate because they must run in this order
 * and each has to be provable on its own:
 *
 *   1. {@link reconcilePronunciations} re-normalises the word pronunciations
 *      Iteration 1 loaded, so every runtime row tokenises (D4 §5.7).
 *   2. {@link seedPhonemes} loads the frozen 41-unit inventory, deriving
 *      `frequency_rank` from occurrence counts over that reconciled corpus
 *      (D4 §6).
 *   3. {@link populateOccurrences} writes `pronunciation_phonemes`.
 *
 * The order matters and is not the order a reader might assume. The rank is
 * derived from the SUPPORTED corpus, so reconciliation has to happen first or
 * the counts include rows that are about to be deleted and exclude the extra
 * realisations expansion is about to add.
 *
 * Reusable normalise/validate/load logic lives here per E1; the entry point is
 * `scripts/seed-phonemes.js`.
 */

import {
  countPhonemes,
  listPhonemes,
  parkFrequencyRanks,
  replacePronunciationPhonemes,
  setFrequencyRank,
  setPrimaryExampleWord,
  upsertExampleWord,
  upsertPhoneme,
} from '../repositories/phonemes.repository.js';
import {
  deletePronunciationById,
  findPronunciationsByWordId,
  setPronunciationPrimary,
  listAllPronunciations,
  listWordsForVariant,
  updatePronunciationTranscription,

} from '../repositories/words.repository.js';
import { withTransaction } from '../repositories/transaction.js';
import { loadInventory, tokenizeTranscription } from './ipa-tokenization.service.js';

/**
 * Re-normalise every stored pronunciation for a variant against frozen D4.
 *
 * Three outcomes per source row:
 *
 *   - it already equals its canonical form: untouched;
 *   - it normalises to a different string, or expands into several: the
 *     canonical forms replace it;
 *   - it does not tokenise: it is REMOVED from the runtime table and reported.
 *
 * The removal is the point of D4 §5.7. Iteration 1 stored raw upstream
 * transcriptions, some carrying narrow or non-American notation the canonical
 * inventory cannot represent; FR-IPA-01 requires every runtime pronunciation to
 * tokenise, so those rows cannot survive. They remain in the raw and curation
 * artifacts, which is where unsupported upstream evidence belongs.
 *
 * A word is never left with no pronunciation: the guard below refuses to remove
 * a row that would empty a word, and reports it instead, because that is a seed
 * defect rather than something to resolve by deleting content.
 *
 * @param {object} options
 * @param {object} options.variant
 * @param {boolean} [options.dryRun]
 * @returns {Promise<object>} a reviewable report
 */
export async function reconcilePronunciations({ variant, dryRun = false }) {
  const inventory = await loadInventory(variant.code);
  const words = await listWordsForVariant(variant.variantId);

  const report = { unchanged: 0, rewritten: [], merged: [], expansionCandidates: [], removed: [], blocked: [] };

  for (const word of words) {
    const pronunciations = await findPronunciationsByWordId(word.wordId);

    // Decide the whole word before writing anything, so the "would this empty
    // the word" question is answered against the final state rather than the
    // order rows happen to be visited in.
    const decisions = pronunciations.map((pronunciation) => {
      const result = tokenizeTranscription(pronunciation.ipaTranscription, inventory);
      return { pronunciation, result };
    });

    const survivors = decisions.filter((decision) => decision.result.ok);
    if (survivors.length === 0) {
      report.blocked.push({
        word: word.normalizedHeadword,
        reason: 'every pronunciation fails to tokenise; refusing to leave the word empty',
        transcriptions: decisions.map((d) => d.pronunciation.ipaTranscription),
      });
      continue;
    }

    for (const { pronunciation, result } of decisions) {
      if (!result.ok) {
        if (result.consumed) {
          continue;
        }
        report.removed.push({
          word: word.normalizedHeadword,
          ipa: pronunciation.ipaTranscription,
          offending: result.offending,
        });
        if (!dryRun) {
          await deletePronunciationById(pronunciation.pronunciationId);
        }
        continue;
      }

      const forms = result.forms.map((form) => form.ipa);
      const [canonical, ...extra] = forms;

      if (canonical !== pronunciation.ipaTranscription) {
        // Two source notations can canonicalise to the SAME string — `clothes`
        // carries both `/kloʊ(ð)z/` and `/kloʊðz/`, which are one pronunciation
        // written twice. `UNIQUE (word_id, ipa_transcription)` refuses the
        // rename, and rightly so: this is a merge, not a rewrite.
        //
        // The sibling is removed and the source row keeps its identity, so the
        // upstream ordering survives. If the sibling held `is_primary` and the
        // survivor did not, the flag moves across — a word must not end up with
        // no primary, which the unique index permits but E4 forbids.
        const sibling = decisions.find(
          (other) =>
            other.pronunciation.pronunciationId !== pronunciation.pronunciationId &&
            other.result.ok &&
            other.result.forms[0].ipa === canonical,
        );

        if (sibling) {
          report.merged.push({
            word: word.normalizedHeadword,
            from: pronunciation.ipaTranscription,
            into: canonical,
          });
          if (!dryRun) {
            const inheritsPrimary = sibling.pronunciation.isPrimary && !pronunciation.isPrimary;
            await deletePronunciationById(sibling.pronunciation.pronunciationId);
            await updatePronunciationTranscription(pronunciation.pronunciationId, canonical);
            if (inheritsPrimary) {
              await setPronunciationPrimary(pronunciation.pronunciationId, true);
            }
          }
          // The sibling is gone; skip it when the loop reaches it.
          sibling.result = { ok: false, consumed: true };
          continue;
        }

        report.rewritten.push({
          word: word.normalizedHeadword,
          from: pronunciation.ipaTranscription,
          to: canonical,
          notes: result.notes,
        });
        if (!dryRun) {
          await updatePronunciationTranscription(pronunciation.pronunciationId, canonical);
        }
      } else if (extra.length === 0) {
        report.unchanged += 1;
      }

      // D4 §5.4 PERMITS an optional segment other than (ɹ) to become a second
      // row, but only "where both realisations are genuinely supported en-US
      // pronunciations". That is a content judgement, and it cannot be made
      // mechanically: dropping the schwa from `/ˈkɪt͡ʃ(ə)n/` yields `/ˈkɪtʃn/`,
      // a syllable with no nucleus — the source's notation for a syllabic [n̩],
      // which D4 §5.3.2 canonicalises straight back to `ən`. Writing it would
      // put a vowel-less syllable on a pronunciation-teaching page. Yet the same
      // expansion on `/ˈfæm(ə)li/` yields `/ˈfæmli/`, which IS a real
      // two-syllable pronunciation of `family`.
      //
      // So the candidate is REPORTED for curation rather than written. The
      // segment-present realisation is kept as canonical, which is never wrong,
      // and a maintainer opts a genuine variant in through the curation file —
      // the same route the Iteration 1 syllable breakdowns took.
      for (const form of extra) {
        report.expansionCandidates.push({
          word: word.normalizedHeadword,
          from: pronunciation.ipaTranscription,
          kept: canonical,
          candidate: form,
        });
      }
    }
  }

  return report;
}

/**
 * Count canonical-unit occurrences across the supported corpus (D4 §6).
 *
 * @param {object} variant
 * @returns {Promise<Map<string, number>>}
 */
export async function countUnitOccurrences(variant) {
  const inventory = await loadInventory(variant.code);
  const pronunciations = await listAllPronunciations(variant.variantId);
  const counts = new Map();

  for (const pronunciation of pronunciations) {
    const result = tokenizeTranscription(pronunciation.ipaTranscription, inventory);
    if (!result.ok) {
      continue;
    }
    for (const unit of result.forms[0].units) {
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * Derive the dense, unique 1..N ranking (D4 §6, FR-IPA-01).
 *
 * More frequent means a LOWER rank number. Equal counts — including the zero
 * counts a small corpus leaves for a rare unit — break by D4 `canonicalOrder`,
 * which is what makes the result deterministic rather than dependent on map
 * iteration order.
 *
 * @param {object[]} units the D4 inventory, in canonical order
 * @param {Map<string, number>} counts
 * @returns {Array<{ipaSymbol: string, frequencyRank: number, occurrences: number}>}
 */
export function deriveFrequencyRanks(units, counts) {
  return [...units]
    .map((unit) => ({
      ipaSymbol: unit.ipaSymbol,
      occurrences: counts.get(unit.ipaSymbol) ?? 0,
      canonicalOrder: unit.canonicalOrder,
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.canonicalOrder - b.canonicalOrder)
    .map((unit, index) => ({
      ipaSymbol: unit.ipaSymbol,
      frequencyRank: index + 1,
      occurrences: unit.occurrences,
    }));
}

/**
 * Load the frozen inventory and its teaching examples.
 *
 * Runs in ONE transaction because the circular pointer of SDD §4.2 is only
 * resolvable across several statements: insert the phoneme, insert its example
 * words, then set `primary_example_word_id`. A partial application would leave
 * the pointer null, which the validator treats as a defect.
 *
 * @param {object} options
 * @param {object} options.variant
 * @param {(unit: object) => Promise<number>} options.resolveAudioAssetId
 * @returns {Promise<object>} a reviewable report
 */
export async function seedPhonemes({ variant, resolveAudioAssetId }) {
  const inventory = await loadInventory(variant.code);
  const counts = await countUnitOccurrences(variant);
  const ranked = deriveFrequencyRanks(inventory.units, counts);
  const rankBySymbol = new Map(ranked.map((entry) => [entry.ipaSymbol, entry.frequencyRank]));

  // Resolved OUTSIDE the transaction: registering an asset is its own idempotent
  // operation, and holding a transaction open across it would serialise the
  // seed behind whatever the audio pipeline is doing.
  const audioAssetIds = new Map();
  for (const unit of inventory.units) {
    audioAssetIds.set(unit.ipaSymbol, await resolveAudioAssetId(unit));
  }

  await withTransaction(async (tx) => {
    // `frequency_rank` is UNIQUE per variant, so a re-seed that reorders the
    // ranking would collide mid-update against ranks still held by other rows.
    await parkFrequencyRanks(variant.variantId, tx);

    for (const unit of inventory.units) {
      const phonemeId = await upsertPhoneme(
        {
          variantId: variant.variantId,
          ipaSymbol: unit.ipaSymbol,
          // Park this row too; the real rank is applied below, once every row
          // has vacated the positive range.
          frequencyRank: -(unit.canonicalOrder + inventory.units.length),
          audioAssetId: audioAssetIds.get(unit.ipaSymbol),
        },
        tx,
      );

      const exampleWordId = await upsertExampleWord(
        {
          phonemeId,
          exampleWord: unit.exampleWord,
          phonemicTranscription: unit.phonemicTranscription,
          // D4's examples demonstrate the SOUND, which is the FIND-01 fix: the
          // unit must occur somewhere in the transcription, not necessarily
          // word-initially (E2, FR-IPA-08).
          matchMode: 'sound',
          sourceReference: unit.sourceReference,
        },
        tx,
      );

      await setPrimaryExampleWord(phonemeId, exampleWordId, tx);
    }

    for (const unit of inventory.units) {
      await setFrequencyRank(
        {
          variantId: variant.variantId,
          ipaSymbol: unit.ipaSymbol,
          frequencyRank: rankBySymbol.get(unit.ipaSymbol),
        },
        tx,
      );
    }
  });

  return { units: inventory.units.length, ranked, occurrences: counts };
}

/**
 * Write the ordered clickable occurrences for every supported pronunciation.
 *
 * @param {object} options
 * @param {object} options.variant
 * @returns {Promise<object>}
 */
export async function populateOccurrences({ variant }) {
  const inventory = await loadInventory(variant.code);
  const phonemes = await listPhonemes(variant.variantId);
  const idBySymbol = new Map(phonemes.map((phoneme) => [phoneme.ipaSymbol, phoneme.phonemeId]));
  const pronunciations = await listAllPronunciations(variant.variantId);

  const report = { pronunciations: 0, occurrences: 0, skipped: [] };

  for (const pronunciation of pronunciations) {
    const result = tokenizeTranscription(pronunciation.ipaTranscription, inventory);
    if (!result.ok) {
      // Reconciliation should have removed these already; reaching here means
      // the two stages disagree, which is worth reporting rather than hiding.
      report.skipped.push({ ipa: pronunciation.ipaTranscription, offending: result.offending });
      continue;
    }

    const occurrences = result.forms[0].units.map((symbol, position) => ({
      position,
      phonemeId: idBySymbol.get(symbol),
    }));

    if (occurrences.some((occurrence) => occurrence.phonemeId === undefined)) {
      report.skipped.push({
        ipa: pronunciation.ipaTranscription,
        offending: 'a tokenised unit has no phoneme row; seed the inventory first',
      });
      continue;
    }

    await replacePronunciationPhonemes(pronunciation.pronunciationId, occurrences);
    report.pronunciations += 1;
    report.occurrences += occurrences.length;
  }

  return report;
}

/**
 * Assert the post-seed invariants of FR-IPA-01 and D4 §5.7.
 *
 * Returns problems rather than throwing, so the entry point can print all of
 * them at once; a seed that fails four invariants should say so in one run.
 *
 * @param {object} options
 * @param {object} options.variant
 * @returns {Promise<string[]>} an empty array when every invariant holds
 */
export async function validateSeed({ variant }) {
  const inventory = await loadInventory(variant.code);
  const problems = [];

  const stored = await listPhonemes(variant.variantId);
  const expected = new Set(inventory.units.map((unit) => unit.ipaSymbol));
  const actual = new Set(stored.map((phoneme) => phoneme.ipaSymbol));

  for (const symbol of expected) {
    if (!actual.has(symbol)) {
      problems.push(`missing canonical unit: ${symbol}`);
    }
  }
  for (const symbol of actual) {
    if (!expected.has(symbol)) {
      problems.push(`unit present but not in D4: ${symbol}`);
    }
  }

  const total = await countPhonemes(variant.variantId);
  if (total !== inventory.units.length) {
    problems.push(`expected ${inventory.units.length} phonemes, found ${total}`);
  }

  const ranks = stored.map((phoneme) => phoneme.frequencyRank).sort((a, b) => a - b);
  const dense = ranks.every((rank, index) => rank === index + 1);
  if (!dense) {
    problems.push(`frequency_rank is not dense and unique 1..${stored.length}`);
  }

  for (const phoneme of stored) {
    if (!phoneme.audioAssetId) {
      problems.push(`${phoneme.ipaSymbol}: no audio_asset_id`);
    }
    if (!phoneme.primaryExampleWordId) {
      problems.push(`${phoneme.ipaSymbol}: no primary_example_word_id`);
    }
  }

  // D4 §5.7: after convergence, EVERY runtime pronunciation must tokenise.
  const pronunciations = await listAllPronunciations(variant.variantId);
  for (const pronunciation of pronunciations) {
    const result = tokenizeTranscription(pronunciation.ipaTranscription, inventory);
    if (!result.ok) {
      problems.push(
        `runtime pronunciation does not tokenise: /${pronunciation.ipaTranscription}/ ` +
          `(blocked by ${JSON.stringify(result.offending)})`,
      );
    }
  }

  return problems;
}
