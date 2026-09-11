# PronounceAll — Iteration 2 Completion Handoff

**Version:** 1.0
**Date:** 2026-09-11
**Status:** Iteration 2 code complete, audio generated and verified (6 191 assets). Awaiting the maintainer listening pass before the iteration closes — see §3.
**Purpose:** Record what Iteration 2 built, what it deliberately did not, and what Iteration 3 inherits.

---

## 1. What was built

Implemented in the order the maintainer fixed, so each layer was proven before
the next depended on it.

### 1.1 Schema — `V4__phoneme_and_audio.sql`, `V5__audio_asset_key_collation.sql`

`audio_assets`, `phonemes`, `phoneme_example_words`, `pronunciation_phonemes`,
and the staged `word_pronunciations.whole_word_audio_asset_id` with its foreign
key. Every FK is `ON DELETE RESTRICT` (SDD §4.9); no cascade is used anywhere.

The circular reference `phonemes.primary_example_word_id` →
`phoneme_example_words` is resolved without cascades: the column is created
nullable and without its FK, `phoneme_example_words` is created, then `ALTER
TABLE` adds the constraint. The column is nullable at INSERT only; the seed
validator asserts it non-null at completion.

`V5` corrects a defect in `V4` (§4.1).

Not added, still rejected: `phonemes.is_active`, `word_pronunciations.source_ipa`.

### 1.2 Production normaliser and tokenizer — `src/services/ipa-tokenization.service.js`

Implements frozen D4 §5. NFC, documented source-profile rules only, longest-match
canonical tokenisation, permitted marks handled separately, fail-closed on
unmatched residue, no inventory expansion.

The D4 §7 fixture suite runs against **this** implementation, not a prototype:
`tests/unit/ipa-tokenization.service.test.js`, 37 tests.

The canonical inventory is not hand-copied into code. `scripts/extract-phoneme-inventory.js`
derives `data/seed/en-us.phonemes.json` from D4's §4 table, and
`npm run inventory:check` fails if the artifact drifts from the document. CI runs
that check in the lint job.

### 1.3 Audio asset path

- `src/lib/audio-storage.js` — the V4 filesystem adapter. Content-addressed
  SHA-256 filenames, atomic write-then-rename, integrity verification.
- `src/repositories/audio-assets.repository.js` — the C6 idempotency mechanism as
  SQL: `UNIQUE (asset_key)` plus an atomic compare-and-set on
  `generation_status`, so two workers cannot both generate one asset.
- `src/services/audio-asset.service.js` — deterministic keys
  (`kind:variant:target:source[:voice:version]`), claim/produce/verify. Holds no
  infrastructure client; the storage adapter and the producer are injected.

No server-side TTS on the request path. Nothing is generated at runtime.

### 1.4 Content pipeline — `src/services/phoneme-ingestion.service.js`, `scripts/seed-phonemes.js`

Three stages, run in this order:

1. **reconcile** the Iteration 1 word pronunciations against D4;
2. **seed** the 41 canonical units, deriving `frequency_rank` from occurrence
   counts over the reconciled corpus;
3. **populate** `pronunciation_phonemes`.

**The order differs from the iteration plan, deliberately.** D4 §6 derives the
rank from the *supported* corpus, so reconciliation has to run first — ranking
before it would count rows about to be deleted. This is documented at the top of
both the service and the script.

### 1.5 UI — clickable IPA and the popover

Each phoneme is a server-rendered `<button>` built from `pronunciation_phonemes`,
carrying `data-phoneme-id`. No IPA is parsed at render, and browser JavaScript
performs no linguistic parsing — it reads data attributes the server resolved.

`src/public/js/phoneme-popover.js` is a progressive enhancement: with JavaScript
disabled the buttons are inert and the transcription still reads as complete
text. `<button>` gives keyboard focus and Enter/Space activation natively;
Escape closes and returns focus.

---

## 2. Verification

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run lint:licence` | 76 files |
| `npm run inventory:check` | artifact matches D4, 41 units |
| Unit tests | **124 passed** (37 new, the D4 §7 fixtures) |
| Integration tests | **72 passed** (17 new, the seed invariants) |
| Playwright chromium | **40 passed** |
| Playwright webkit | **40 passed** |
| Playwright no-javascript | **22 passed** |
| Playwright firefox | **fails locally — see §5** |
| `npm run size` | 5.3 kB gzipped against the 150 kB NFR-PERF-07 budget |
| `npm audit` | 0 vulnerabilities |

Seed state after convergence, asserted by `validateSeed` and by
`tests/integration/phoneme-seed.test.js`:

- 41 phonemes, exact set equality with D4 — no missing row, no extra row;
- `frequency_rank` dense and unique 1..41, derived, ties broken by canonical order;
- every phoneme has `audio_asset_id` and `primary_example_word_id`;
- every D4 example contains its target unit (FR-IPA-08, the FIND-01 rule);
- 179 runtime pronunciations, **100 % tokenise** (D4 §5.7);
- 993 `pronunciation_phonemes` occurrences;
- no canonical transcription retains parenthesis notation;
- every word still has exactly one primary pronunciation.

The seed is idempotent: a second run reports 179 unchanged, 0 changes.

---

## 3. Phoneme audio — DONE as of 2026-09-11

> **RESOLVED.** Everything in this section described the state before the audio
> was generated. It is kept as the record of how the decision was reached.
>
> All 41 canonical units now have a ready, verified asset, generated with Piper
> through the owner-approved raw-phoneme-injection profile
> (`data/seed/en-us.piper-profile.json`). 6 150 whole-word assets were generated
> too, so `audio_assets` holds 6 191 ready rows and `npm run audio:verify`
> passes at 41/41 canonical coverage with zero integrity problems.
>
> `FR-CONTENT-02`, `FR-CONTENT-03`, `FR-IPA-04`, `FR-IPA-05` and `FR-IPA-06` are
> now implemented. What remains before Iteration 2 closes is the maintainer
> LISTENING PASS over the generated audio — content QA, not a design decision.
> See §10 of the session handoff.

### The original record

**All 41 `audio_assets` rows are `pending`. No audio file exists.**

They are real, licensed rows carrying a deterministic key and provenance, not
placeholders invented to satisfy the NOT NULL foreign key. Nothing fabricates a
digest, a length, or a file: the `ck_audio_assets_ready_is_complete` check
constraint refuses to let a row claim `ready` without them.

The consequence is visible and deliberate:

- the popover renders symbol and example word, and **hides** the replay control;
- no `<audio>` element is rendered on any word page.

A control that cannot play is worse than none — the rule Iteration 1 applied to
whole-word audio and §4.12 applies to secondary pronunciations.

**Therefore `FR-CONTENT-02`, `FR-IPA-04`, `FR-IPA-05`, `FR-IPA-06` and
`NFR-PERF-06` are NOT satisfied, and Iteration 2 is not closed.**

### What blocks it

A source for the 41 canonical recordings must be chosen. A survey was run
(2026-09-11) against Wikimedia Commons:

- **34 of 41** units have an isolated-articulation recording under CC BY-SA 3.0
  with author metadata — for example `Voiceless_bilabial_plosive.ogg` for `/p/`.
- **`w`, `ɝ`, `ɚ`** have no such file under the obvious names.
- The **five diphthongs** have no isolated recording. The only Commons
  candidates are whole-WORD recordings (`En-us-eight.ogg`), which are a
  different kind of asset: clicking `/eɪ/` would play the word "eight".

Mixing whole-word recordings in among isolated articulations without saying so
would be the same class of problem as fake audio, so it was not done.

**This is teaching content and needs the same sign-off the D4 example words got.**
The options, briefly:

1. **Piper for all 41** (V1, the decided TTS path). Uniform, regenerable,
   provenance clean, needs the Piper batch to be built and run.
2. **Commons where available, Piper for the rest.** Human articulations for 34,
   synthesis for 7 — better audio, mixed provenance, two licences to attribute.
3. **Commons plus word exemplars for diphthongs**, explicitly labelled as
   exemplars in the popover. Cheapest, but changes what a click means.

**Correction (2026-09-11).** The sentence that stood here — that the
infrastructure is finished for any of them and "only the producer differs" — was
wrong. The register/claim/produce/store/verify path is indeed finished and is
source-agnostic, but the *asset identity* is not. `assetKeyFor()` embeds
`sourceKind`, so a Commons unit gets a different `asset_key` than the `tts_piper`
row already registered for it; `registerAsset` upserts on `asset_key`, so the
existing `pending` rows for those units would survive as orphans needing
cleanup. `source_kind` is an `ENUM('wiktionary_human','tts_piper','tts_cloud')`
with no value for a Commons isolated articulation, so options 2 and 3 additionally
require a `V6` migration (or a deliberate decision to record them as
`wiktionary_human`), a re-seed, and per-row licence/author/`source_reference`
metadata. That is schema and data work, not a producer swap.

**Decision (2026-09-11): option 1 — Piper for all 41.** Options 2 and 3 are
rejected for v1 and are not to be implemented. The existing `tts_piper` rows and
asset keys are reused as they stand; no `V6` is added for this work.

---

## 4. Defects found and fixed during the iteration

### 4.1 `ð` collided with `d` on the audio asset key

`audio_assets.asset_key` inherited the table default `utf8mb4_0900_ai_ci`, which
is accent-insensitive. The deterministic phoneme key embeds the IPA symbol, and
under that collation **`ð` compares equal to `d`**, so the two units shared one
`audio_assets` row — 40 assets for 41 phonemes. They would have played the same
recording.

`V4` had already guarded `phonemes.ipa_symbol` and
`word_pronunciations.ipa_transcription`; `asset_key` was missed because it reads
as an opaque identifier while in fact carrying IPA. Fixed by `V5`, and now
asserted by two integration tests.

**Rule for later iterations:** any column that can contain an IPA symbol —
directly or embedded in a composite key — takes `utf8mb4_0900_as_cs`.

### 4.2 Canonical forms could collide with an existing sibling row

`clothes` carried both `/kloʊ(ð)z/` and `/kloʊðz/`. Normalising the first
produces the second, and `UNIQUE (word_id, ipa_transcription)` refused the
rename. That is a **merge**, not a rewrite: the sibling is removed, the source row
keeps its identity and ordering, and `is_primary` transfers if the removed row
held it. Without the transfer a word could end up with no primary, which the
unique index permits but E4 forbids.

### 4.3 `frequency_rank` collided with itself on re-seed

`UNIQUE (variant_id, frequency_rank)` makes an in-place reordering collide
against ranks still held by other rows. The seed now parks every rank in a
disjoint negative range first, then assigns, inside one transaction.

---

## 5. Known local environment issue — not a product defect

**Firefox fails on this Windows machine at browser-context teardown**, across
every spec including untouched Iteration 1 ones:

```
browserContext.close: Protocol error (Browser.removeBrowserContext):
  can't access property "_maybeDontRestoreTabs", this._windows[aWindow.__SSi] is undefined
```

The assertions pass; the failure is in teardown, often followed by a 30 s
timeout. It degraded over the session — Firefox passed 25/25 earlier the same day
— which points at accumulated local state, not at the code. Chromium, WebKit and
the no-JavaScript profile all pass in full.

Per the maintainer's standing instruction: **do not alter product code or
Iteration 0/1 tests to work around it.** Linux CI is the authoritative
parallel-environment check.

---

## 6. Decision recorded — optional-segment expansion is reported, not written

D4 §5.4 permits an optional source segment to expand into separate
`word_pronunciations` rows "provided both realisations are genuinely supported
en-US pronunciations". That qualification cannot be evaluated mechanically:

- `/ˈfæm(ə)li/` → `/ˈfæməli/` and `/ˈfæmli/` — **both genuine**;
- `/ˈkɪt͡ʃ(ə)n/` → `/ˈkɪtʃən/` and `/ˈkɪtʃn/` — the second is a syllable with no
  nucleus, the source's notation for a syllabic `[n̩]`, which D4 §5.3.2
  canonicalises straight back to `ən`.

Writing the second would put a vowel-less syllable on a teaching page. So the
segment-present realisation is kept as canonical — never wrong — and the
alternative is **reported for curation**. Four candidates were reported on the
converging run; they are recoverable from `data/seed/en-us.raw.json`.

If the maintainer wants specific variants in, the route is the curation file, the
same one the Iteration 1 syllable breakdowns used.

---

## 7. What Iteration 3 inherits

Iteration 3 is **Save/tag system** (three-state save for words and phonemes,
append-only event log, derived state, anonymous-first).

Newly available and relevant:

| Thing | Where |
|---|---|
| `phonemes` with stable ids | the save target for `/learnIPA` tagging |
| `pronunciation_phonemes` | `data-phoneme-id` already on every word page element |
| The B2 hydration seam | still unbuilt — Iteration 3 is its first real consumer |
| `src/repositories/transaction.js` | B3 writes derived state in the same transaction as the event |

Still absent, correctly: `users`, `anonymous_profiles`, `user_activity_events`,
`identity_bindings`, `user_word_states`, `user_phoneme_states`. Migrations start
at `V6__`.

`word_requests.submitted_by_user_id` still has no FK to `users`; the
authentication iteration adds it.

---

## 8. Outstanding for Iteration 2 closure

- [ ] Choose the phoneme audio source (§3) — **maintainer decision**
- [ ] Build the Piper batch job under C6, or the Commons ingest, per that choice
- [ ] Generate the 41 assets; every phoneme's asset reaches `ready`
- [ ] Whole-word audio and the FR-IPA-05 fallback chain
- [ ] `/:variant/learnIPA` and `/learnIPA` (FR-IPA-07, FR-IPA-10)
- [ ] `FR-IPA-09` IPA rendering fonts (*Should*)
- [ ] Re-run the integrity check once assets exist (FR-CONTENT-04)

The learning pages were not started: they display the inventory ordered by
`frequency_rank`, which now exists, but they are a page-building task of their
own and the audio question sits in front of them.
