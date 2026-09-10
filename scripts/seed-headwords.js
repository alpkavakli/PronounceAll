/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Iteration 1 seed headword list (FR-WORD-10, FR-CONTENT-01, decision E1).
 *
 * Iteration 1 seeds roughly 100 common American English words. FR-WORD-10's
 * 5 000-headword figure is the v1.0 LAUNCH target, not this iteration's: the
 * iteration order in the Handoff scopes Iteration 1 to "a seed dataset of ~100
 * common American English words" and puts the full launch dataset in the
 * hardening iteration. The pipeline is what has to scale; the list is data.
 *
 * The list is keyed by variant because E1 makes variant a DATA dimension rather
 * than a code branch: adding `en-gb` adds a key here and a `language_variants`
 * row, not a code path.
 *
 * Composition is deliberate rather than a frequency dump:
 *
 *   - `cupcake` and `friend` are named in acceptance criteria (FR-WORD-04:
 *     `cuppcake` must surface `cupcake`; `freind` must surface `friend`).
 *   - `mother-in-law` and `don't` exercise the FR-WORD-02 allow-list, which
 *     admits hyphen and apostrophe.
 *   - `record`, `lead`, `read`, `live`, `close`, `object`, `present`, and
 *     `content` are heteronyms, which exercise the E4 many-pronunciations-per-
 *     word model and the "exactly one is_primary" invariant.
 *   - the remainder are high-frequency everyday words, weighted towards the
 *     multi-syllable stress patterns a learner actually struggles with.
 */

/**
 * Words that must be in the seed whatever the frequency ranking says.
 *
 * These are no longer the whole selection — the bulk now comes from the ranked
 * source (see `selectHeadwords`). They are kept as GUARANTEED inclusions because
 * each earns its place for a reason the ranking cannot know:
 * acceptance-criteria words, allow-list exercises, and heteronyms that exercise
 * the E4 many-pronunciations model.
 *
 * @type {Record<string, string[]>}
 */
export const CURATED_HEADWORDS = {
  'en-us': [
    // Acceptance-criteria words and allow-list exercises.
    'cupcake',
    'friend',
    'mother-in-law',
    "don't",

    // Heteronyms — several pronunciations under one headword (E4).
    'record',
    'lead',
    'read',
    'live',
    'close',
    'object',
    'present',
    'content',
    'desert',
    'produce',

    // Everyday nouns.
    'water',
    'people',
    'family',
    'money',
    'business',
    'school',
    'student',
    'teacher',
    'question',
    'answer',
    'language',
    'word',
    'letter',
    'number',
    'picture',
    'computer',
    'telephone',
    'address',
    'city',
    'country',
    'island',
    'mountain',
    'weather',
    'morning',
    'evening',
    'birthday',
    'holiday',
    'restaurant',
    'hospital',
    'library',
    'kitchen',
    'garden',
    'window',
    'bottle',
    'banana',
    'orange',
    'vegetable',
    'chocolate',
    'breakfast',
    'dinner',
    'coffee',
    'sugar',
    'butter',
    'knife',
    'clothes',
    'shoes',
    'pocket',
    'camera',
    'music',
    'movie',
    'color',
    'animal',
    'elephant',
    'butterfly',
    'daughter',
    'brother',
    'neighbor',
    'doctor',
    'engineer',

    // Verbs.
    'ask',
    'begin',
    'believe',
    'bring',
    'buy',
    'choose',
    'develop',
    'enough',
    'explain',
    'finish',
    'follow',
    'imagine',
    'listen',
    'measure',
    'promise',
    'remember',
    'suggest',
    'thought',
    'through',
    'travel',
    'understand',
    'visit',
    'walk',
    'watch',
    'work',
    'write',

    // Adjectives and adverbs.
    'beautiful',
    'busy',
    'careful',
    'comfortable',
    'dangerous',
    'different',
    'difficult',
    'early',
    'famous',
    'favorite',
    'important',
    'interesting',
    'necessary',
    'quiet',
    'serious',
    'strange',
    'terrible',
    'usually',
    'wonderful',

    // Function and high-frequency words with awkward spellings.
    'because',
    'another',
    'together',
    'whether',
    'women',
    'children',
  ],
};

/**
 * Ordinary vocabulary a learner would expect to find, asserted by the seed
 * smoke test (FIND-11).
 *
 * This list is NOT a selection source — it is a tripwire. The 123-word
 * development sample looked reasonable and was missing `happy`, `good`, `house`,
 * `think` and thirty others, which is exactly the failure this catches: a seed
 * that is large but quietly missing the words people actually type.
 *
 * @type {Record<string, string[]>}
 */
export const SMOKE_VOCABULARY = {
  'en-us': [
    'beautiful', 'gorgeous', 'happy', 'sad', 'good', 'bad', 'big', 'small',
    'house', 'home', 'car', 'street', 'food', 'love', 'friend', 'family',
    'work', 'school', 'university', 'computer', 'phone', 'music', 'movie',
    'book', 'water', 'coffee', 'restaurant', 'travel', 'country', 'city',
    'man', 'woman', 'child', 'person', 'think', 'know', 'want', 'need',
    'make', 'take', 'give', 'come', 'go', 'see', 'look', 'feel', 'say', 'tell',
  ],
};

/**
 * Choose the headwords to fetch, most common first.
 *
 * Selection is automatic: the ranked source decides, and the two hand-written
 * lists above only guarantee inclusion. Nothing here curates thousands of words
 * by hand.
 *
 * Ordering matters beyond tidiness. The fetch is bounded by `limit`, so putting
 * the guaranteed words first means a truncated or interrupted run still holds
 * the vocabulary the smoke test asserts, and the rest arrives in frequency
 * order — the most useful words first.
 *
 * @param {object} options
 * @param {string} options.variant
 * @param {Array<{rank: number, word: string}>} options.ranked frequency-ordered
 * @param {number} options.limit how many headwords to return
 * @returns {string[]} deduplicated headwords, guaranteed first, then by rank
 */
export function selectHeadwords({ variant, ranked, limit }) {
  const guaranteed = [
    ...(CURATED_HEADWORDS[variant] ?? []),
    ...(SMOKE_VOCABULARY[variant] ?? []),
  ];

  const chosen = [];
  const seen = new Set();
  for (const word of guaranteed) {
    if (!seen.has(word)) {
      seen.add(word);
      chosen.push(word);
    }
  }

  for (const entry of [...ranked].sort((a, b) => a.rank - b.rank)) {
    if (chosen.length >= limit) {
      break;
    }
    if (!seen.has(entry.word)) {
      seen.add(entry.word);
      chosen.push(entry.word);
    }
  }

  return chosen;
}

export default CURATED_HEADWORDS;
