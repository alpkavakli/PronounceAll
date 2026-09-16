# PronounceAll — Session Handoff, 2026-09-16

**Status:** Resume point. Supersedes `PronounceAll_Session_Handoff_2026-09-11.md`
for current state; that document remains accurate for Iteration 0–2 history.
**Head:** `e530a8b`, `main`, 6 ahead of `origin/main`, working tree clean.
**Not specification authority.** Consult `DOC_INDEX.md` first, as always.

---

## 0. The one decision blocking progress — RESOLVED (see §3.1)

**Review `data/seed/en-us.syllable-overrides.json` (19 rows).**

Nothing else is waiting on anything. The syllabification work is built,
validated and frozen; it is not yet persisted, and persistence is gated on this
review.

The artifact holds the rows where our algorithm and an independent reference
divide a word differently with no settled rule to explain it. Almost all are
morpheme boundaries — `base+ment`, `world+wide`, `police+man` — which no
phonological rule can see.

- **13 rows** carry a proposal, each justified by evidence already in the
  repository: Wiktionary hyphenation (syllable count), a compound seam proven by
  both halves being headwords, or a derivational suffix.
- **6 rows** are `ambiguous` and carry **no** proposal, so persistence will
  write no boundary for them: `convenience`, `documents`, `explanation`,
  `occupied`, `perfume`, `senior`. Several are probably right as the algorithm has
  them, but no checkable reference here settles it. Resolving any of these is
  hand curation — set `proposedBreakdown` and `reviewStatus` in the artifact.

**Stress-mark fix (post-handoff, same day).** The algorithm divided the
unstressed sequence and could place a separator one unit before a source stress
mark, writing a nucleus-less syllable (`tɹæn.sˈfɚ`) in 26 corpus rows. A stress
mark now fixes its gap's boundary, a division with a nucleus-less syllable is
refused, and validation compares the division actually displayed. The artifact
was regenerated: 29 → 19 rows, with the removed rows now explained by the
source's own stress marks (`source-stress`). Proposals are stress-free
divisions; persistence must re-apply the stress marks (FR-WORD-03).

Re-run the evidence pass at any time:

```bash
node scripts/review-syllable-overrides.js           # report
node scripts/review-syllable-overrides.js --write   # rewrite statuses
```

---

## 1. What this session changed

| Commit | What |
|---|---|
| `6271a4b` | Recorded the second listening pass and the placeholder-audio decision |
| `2a7967b` | Froze the Frontend Design Baseline; implemented tokens, self-hosted fonts, shell |
| `c5b01ab` | Stress and syllable marks now render in the clickable transcription |
| `2e76f47` | Syllabification algorithm and the corpus pass (dry-run only) |
| `dbdd7c5` | CMUdict + Gorman validation; evidence-based source-defect report; regression suite |
| `e530a8b` | The curated 29-row override artifact |

---

## 2. Decisions that are FROZEN — do not reopen

Reopening any of these is how the previous sessions looped. Each was settled
with evidence and is recorded.

1. **D4 and the 41-unit inventory.** Unchanged. `/ɹ/` not `/r/`, `/ɑ/` not
   `/ɑː/`, no vowel-length marks, atomic diphthongs, `ˈ ˌ .` are the only
   permitted non-clickable marks.
2. **Phoneme audio is placeholder.** All 41 units serve Piper clips the
   maintainer judged wrong. They will record the real clips personally. Do NOT
   run further audio QA, Piper draws, Commons fetches or promotions. See
   `PronounceAll_Phoneme_Audio_Listening_Pass_2026-09-11.md` §5.
3. **Syllabification general rules.** Maximal onset, checked-vowel policy,
   rhotic-coda policy, source boundaries win, stress marks win, genuine hiatus
   is divided, vowel + `/ɚ/` fails closed. Validated at 1 630 of 1 649 alignable
   rows after the stress-mark fix. A new edge case goes in the override artifact, **not** into the
   algorithm, unless it proves a general rule is fundamentally wrong.
4. **`ipa_transcription` is never rewritten for display.** It is half of
   `uq_word_pronunciations_natural (word_id, ipa_transcription)`. Writing dots
   into it makes a later `npm run seed` delete and re-insert the row, changing
   `pronunciation_id` and orphaning `whole_word_audio_asset_id`. Inferred
   structure belongs in `syllable_breakdown`.
5. **No Cambridge scraping.** Cloudflare-gated, and its content has no licence
   compatible with FR-CONTENT-05 / NFR-LEGAL-05. It is a manual benchmark only.
6. **Frontend baseline is frozen and routed in `DOC_INDEX.md`.** Only tokens,
   fonts and the shell are implemented; component sections (§7–§15) are not.

---

## 3. Next steps, in order

### 3.1 Persist syllabification — CLOSED (2026-09-16)

**Status.** `npm run seed:syllables` writes `syllable_breakdown` only. The
override artifact was applied as it stands (13 proposals, 6 ambiguous rows
left unmarked). Precedence, in `planSyllableBreakdown`: source separator →
maintainer curation file → hold on proven source defects (`close` as
`/ɔ/`+`/ʊ/` would otherwise read as two syllables) → reviewed override →
inference → nothing. Result: 2 140 breakdowns written; 1 898 source, 16
curated, 32 defect rows held, 6 unreviewed overrides left alone.

Pipeline order is fixed: `seed` → `seed:phonemes` → `seed:syllables`. `seed`
rewrites the column, so the syllable step must follow every `seed`.

Gate evidence: a second run writes 0; `seed` restores the pre-apply snapshot
exactly and the full pipeline re-produces the applied snapshot exactly (0
differences); `pronunciation_id`, `ipa_transcription`, audio links, primary
and order unchanged across all 7 531 rows. The rebuild was through the
pipeline on the existing database, not from an empty schema.

Closed by maintainer decision, with the override artifact approved as it
stands. Accepted residuals, not reopened: ~570 written rows are absent from
CMUdict and follow the frozen rules without independent validation, and the 6
ambiguous rows stay unmarked unless curated by hand. Deferred, not part of
closure: placing `.` marks in the main visible IPA from `syllable_breakdown`
(a word-page rendering change under Frontend Baseline §8). No further general
syllabification work.

Original plan, kept for reference:

- write inferred structure to `syllable_breakdown` only, never
  `ipa_transcription`;
- precedence: source-supplied breakdown → curated override → algorithmic
  inference → nothing;
- integrate into the deterministic seed pipeline (position: after
  `seed:phonemes`, which produces the units it reads);
- the word page may then place non-clickable `.` marks in the main visible IPA
  from `syllable_breakdown` while the clickable units stay aligned to
  `ipa_transcription`.

**Acceptance gate for marking SYLLABIFICATION CLOSED:**

- clean rebuild reproduces the same breakdowns;
- second run is idempotent;
- canonical IPA rows and `pronunciation_id`s do not change;
- whole-word audio links remain intact;
- regression suite passes;
- no unexplained automatically-written boundary remains.

Do not perform another general syllabification research cycle after that.

### 3.2 The 37 source-normalization defects — 25 RESOLVED, 12 BLOCKED on provenance

**Outcome, per maintainer decision:**

| Class | Rows | Resolution |
|---|---|---|
| GA offglide `ɔʊ̯` for /oʊ/ | 10 | D4 §5.2 row `ɔʊ̯` → `oʊ` (marked sequence only; bare `ɔʊ` untouched). Rows merged into their existing `/oʊ/` twins |
| Non-US offglide forms | 5 (life ×2, still, flew, drew) | Curation `ipa` pins to the existing US forms |
| RP /əʊ/, secondary | 5 (both, comes ×2, shove, rosa) | Curation `ipa` pins |
| RP /əʊ/, primary | 13 | `worry` pinned to Wiktionary's own `/ˈwɝ.i/` (hurry-furry, CA). **12 unresolved**, see below |
| False positives | 4 (crying, burke, monsieur, bourbon) | Kept; detector tightened (offglide only when that pair split; `ɜː(ɹ)` is approved rhotic normalisation) |

**The 12 unresolved rows** — leo, tony, holding, roman, overnight, joanna,
quote, diagnosis, hormones, overboard, opponent, toll. Raw Wiktionary holds
only the RP form; the US form exists only in CMUdict. Curation pins must
appear upstream (by design), and pronunciation provenance is word-level
(`words.source_url`), so there is no honest path to store a CMUdict
transcription. They stay as they are for now, their syllable boundaries held, and are the
ONLY rows the defect report prints. They are learner-facing primaries, so
leaving them is NOT the end state.

**Maintainer decision (2026-09-16):** add minimal per-pronunciation
provenance, then import the US forms. A one-shot re-fetch of the 12 pages
found `quote` now carries `/kwoʊt/` (US, CA) upstream, so it resolves through
Wiktionary; `holding` and `toll` gained only narrow US forms containing `[ɫ]`,
which D4 §3.9 rejects; the other 9 are unchanged. 11 words therefore take a
CMUdict pronunciation with honest CMUdict provenance. No further source
searching. The batch closes when the defect report reaches zero.

Found and fixed on the way: a word re-seed could not remove a pronunciation
once `pronunciation_phonemes` referenced it (RESTRICT FK); it now uses the
occurrence-clearing delete, with an integration test.

Gate: 7 531 → 7 511 rows (21 removed, `worry` primary replaced and its audio
reattached from the existing asset); no other row changed except two
display-order compactions; one primary per word, contiguous order, every
primary has audio; `inventory:check`, `seed:syllables` second run 0, lint,
270 unit, 170 integration, `audio:verify`, 93 Chromium + no-JS e2e.

Original brief, kept for reference:

A separate, finite batch. `node scripts/report-source-defects.js` prints them
with evidence. Two classes:

- an RP form that survived the en-us profile (`both` ← `/bəʊθ/`);
- a source that marked one diphthong with an offglide where we stored two
  vowels (`close` ← GA `/ˈklɔʊ̯z/`, giving `/ɔ/` + `/ʊ/` instead of `/oʊ/`).

The second class points at a real D4 §5 source-profile gap. Compare each row
against the raw Wiktionary source, our canonical row, and CMUdict where
available, then propose an explicit correction set for review. Do not
auto-repair. Do not start a third syllabification redesign because of anything
found here.

### 3.3 Then Iteration 3 product features

`docs/current/PronounceAll_Iteration3_Product_Decisions_and_IPA_Quality_Plan.md`
is untracked in the working tree and has not been reviewed or routed in
`DOC_INDEX.md`. It is not authority yet.

---

## 4. Commands that matter

```bash
# stack
docker compose up -d mysql redis && npm run dev

# content pipeline (documented order)
npm run fetch:headwords     # network
npm run fetch:wiktionary    # network, ~4 min
npm run seed                # words, offline, ~30 s
npm run seed:phonemes       # inventory + occurrences, ~1.7 min
npm run inventory:check     # fails if the artifact drifts from D4
npm run seed:syllables:dry-run   # report
npm run seed:syllables           # write syllable_breakdown; after every seed

# IPA quality
node scripts/validate-syllabification.js            # CMUdict + Gorman report
node scripts/validate-syllabification.js --export data/seed/en-us.syllable-overrides.json
node scripts/review-syllable-overrides.js           # evidence pass
node scripts/report-source-defects.js               # the 37 defects

# gate
npm run lint && npm run lint:licence && npm test && npm run test:e2e && npm run size
npm run audio:verify
```

---

## 5. Environment notes

- **Docker Desktop stops when the machine sleeps.** MySQL and Redis must be up
  before any script; the dev server exits without them.
- **`tools/` is not committed** (`.gitignore`: `/tools/piper/`,
  `/tools/validation/`). Validation tooling is reinstalled with:
  `curl -sL -o tools/validation/syllabify.py https://raw.githubusercontent.com/kylebgorman/syllabify/master/syllabify.py`
  and `cmudict.dict` from `cmusphinx/cmudict`. `tools/validation/boundaries.py`
  IS committed and bridges them. Piper lives in `tools/piper/.venv`.
- **The audio review page** (`data/audio-review/index.html`) cannot be opened
  from disk: the app sends `Cross-Origin-Resource-Policy: same-origin`, so a
  `file://` page is refused every clip. Serve it same-origin instead.
- **Firefox e2e is an intermittent local flake** — `browserContext.close`
  teardown errors with zero assertion failures. Chromium, WebKit and the no-JS
  project are reliable.

---

## 6. Gate at this head

lint clean · licence headers 116 files · 242 unit · 169 integration ·
`audio:verify` PASS (6 225 assets) · database untouched at 7 531 pronunciations,
1 898 already carrying a source separator.

E2E and size were last run green at `c5b01ab`; nothing since then touches
rendering.

---

## 7. Maintainer memory

Two memories are stored for this project and are loaded automatically:

- the 11 phoneme clips approved by ear on 2026-09-15, pinned by digest, never to
  be regenerated or promoted away;
- the 2026-09-16 decision that all phoneme audio is placeholder pending the
  maintainer's own recordings.
