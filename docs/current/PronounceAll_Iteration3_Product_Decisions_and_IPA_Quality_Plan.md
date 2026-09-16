# PronounceAll — Product Direction and Iteration 3 Scope

**Status:** Owner-approved planning input, revised 2026-09-17 after an audit against
the SRS, SDD v1.1, D4, the Frontend Design Baseline and the locked iteration order.
**Not implementation authority.** The §6 amendments were approved and applied on
2026-09-17 (SRS 1.0.4, SDD v1.1 amendment, Frontend Design Baseline amendment); build
from those documents. This document remains the record of the product direction and
of why the scope is split as it is.

**The frozen roadmap is unchanged:** Iteration 3 = save/tag, Iteration 4 =
authentication, Iteration 5 = practice/SM-2 (Handoff Document, iteration order). This
document places the product ideas into that roadmap; it does not re-sequence it.

---

## 1. Product direction

PronounceAll is not just an IPA dictionary. The core loop is:

**LOOK UP → UNDERSTAND → REMEMBER → REVIEW → RECALL → PRONOUNCE**

> PronounceAll remembers the vocabulary a user encounters and later turns those
> encounters into personalised vocabulary and pronunciation review.

The loop is delivered across the existing iterations:

| Step | Iteration |
|---|---|
| Look up, understand (word page, clickable IPA, audio) | 1–2, done |
| Remember (save/tag; learned phonemes; word encounters recorded) | **3** |
| Carry progress across devices (accounts, merge) | 4 |
| Review, recall (SM-2 practice over saved and encountered words) | 5 |

---

## 2. Iteration 3 scope

### 2.1 Unified save/tag for words and phonemes

As already specified: one save control (FR-SAVE-01), states `unsaved` / `saved` /
`learning` / `learned` (FR-SAVE-02), append-only events and derived state
(FR-SAVE-03/04), anonymous use via `pa_uid` (FR-SAVE-05), CSRF and idempotency
(FR-SAVE-08). No amendment needed.

### 2.2 Phoneme mastery display

Inline word IPA answers one question: **have I learned this sound yet?**

- a phoneme whose FR-SAVE state is `learned` → learned (green) semantic state;
- every other state (`unsaved`, `saved`, `learning`) → neutral, not-yet-learned;
- the save/tag popover still distinguishes `saved` from `learning`.

**There is no second mastery state.** No `learned` boolean, no mastery table: the
display is a projection of `user_phoneme_states`.

Rules:

- **no red** for not-yet-learned — not having learned a sound is progress, not error;
- colour is never the only cue (accessible name such as `phoneme /θ/, learned`, and
  a non-colour visual treatment);
- stress marks, syllable dots and slashes are punctuation and are never coloured;
- the transcription stays one continuous readable artifact (Baseline §8.1);
- state is applied from the hydration response keyed by `data-phoneme-id`; the
  browser never parses IPA (D4 §3.10), and the cached shell stays viewer-neutral (B2);
- where state is not known — no JavaScript, or before hydration — the default IPA
  style shows, asserting neither learned nor not yet learned. An anonymous visitor
  with a `pa_uid` **does** have state.

### 2.3 Personalised `/learnIPA` and the progress banner

- the progress-aware banner as already specified (FR-WORD-06);
- `/learnIPA` rows styled by the same learned state, a learned count `M / N` using
  the FR-WORD-06 count, and an optional all / learned / not-yet-learned filter;
- the page remains usable without JavaScript (the list, audio and save control
  degrade as today; the filter is an enhancement).

### 2.4 Small pronunciation UX additions

- **Playback speed** `1×` / `0.75×` for whole-word and phoneme audio. Client-side
  only; no server state. Not more speed values.
- **"Broad en-US IPA" label** with short accessible help text:
  > PronounceAll uses a consistent learner-oriented phonemic transcription. Other
  > dictionaries may use different IPA conventions for the same pronunciation.

### 2.5 Word encounter event foundation

Iteration 3 **records** successful dictionary encounters; it does not review them.

- An encounter is a successful word page for a canonical word. The event stores the
  `word_id` target only.
- **Never stored:** search query strings, failed or raw search text, referrers.
- It is learning history, not advertising or tracking analytics.
- It does not change derived save state and does not create a review schedule.

Decisions (approved 2026-09-17; specified in FR-SAVE-10):

1. **Who is recorded.** FR-AUTH-03 creates an `anonymous_profiles` row only on a
   deliberate progress write. Recording every JavaScript visitor's encounters would
   create a profile and a lookup history for every visitor. **Decided:** record
   encounters only for a registered user or an anonymous actor that already has a
   progress profile. FR-AUTH-03 is unchanged, no casual visitor acquires stored
   history, and earlier browsing is never reconstructed.
2. **Write path.** The hydration read stays read-only (SDD §3.4). **Decided:** a
   separate CSRF-protected `POST` sent by the page script after hydration, using the
   FR-SAVE-08 idempotency key. A no-JavaScript view is not recorded.
3. **Frequency.** **Decided:** at most one encounter event per actor, word and UTC
   day; a repeat writes nothing and never updates or deletes the earlier event.

### 2.6 Implementation order and the privacy gate

1. Unified word and phoneme save/tag, anonymous state, events and derived state,
   hydration.
2. Learned-phoneme presentation, personalised `/learnIPA`, progress banner.
3. Playback speed; "Broad en-US IPA" label and help.
4. Word encounter events — **last**. The encounter write is not enabled in production
   until its privacy obligations are met (Appendix E and NFR-PRIV-02 as amended, the
   Privacy Policy disclosure, a Threat Model entry). This gate does not delay slices
   1–3.

### 2.7 Not in Iteration 3

The automatic review scheduler; the personal vocabulary/history page; recall modes.
These are Iteration 5 (§3).

---

## 3. Iteration 5 — review built on encounters

Beside the existing practice system, at that iteration:

- **"PronounceAll brings previously encountered words back and asks about them."**
- Reuse **SM-2** (FR-PRACTICE-04). No second scheduling algorithm.
- Amend FR-PRACTICE-01/-03 so practice can consume eligible encountered words in
  addition to saved words, and define eligibility and onboarding then.
- Recall modes, in order: Meaning → Word, Word → Meaning, then Audio → Word and
  IPA → Word. Meanings shown outside the word page keep their Wiktionary attribution
  (FR-CONTENT-05).
- Personal vocabulary/history surface: word, last encountered, encounter count,
  saved/tagged state, IPA, due status.
- Do not overclaim: no "87% learned" or "memory strength" figures unless a defined
  algorithm stands behind them.
- Candidate additional modes to evaluate then: search recall, difficult-phoneme
  review.

---

## 4. Post-v1.0 / deferred

Not v1.0 unless the Charter is later amended:

- **Self-recording and reference comparison.** Prohibited in v1.0: FR-PRACTICE-03
  forbids requesting microphone permission, the security headers deny `microphone`
  (NFR-SEC, with a test), and Charter §6 excludes microphone-based features. The
  Charter and `Permissions-Policy` are not to be amended for it now. When revisited:
  local/session-only recording, never a silent upload, no fake scoring.
- Automatic or AI pronunciation scoring.
- Search-derived phoneme insights ("you encountered /θ/ in 8 words") — Charter §6
  excludes user-facing analytics dashboards.
- `ipa-dict` full-corpus discrepancy cycle (§5.2).
- IPA matching games, IPA puzzles, heavy gamification, achievement surfaces.
- Camera or image OCR, offline/PWA package, many voice styles, translation.
- UK-English inventory.

---

## 5. IPA quality — closed

### 5.1 What was done

- Syllabification: closed at `9e9e374` (handoff §3.1).
- Source normalization: closed at `d0c85ba` (handoff §3.2), including per-pronunciation
  provenance for CMUdict-sourced rows.
- The "Broad en-US IPA" label is the only remaining item and is in Iteration 3 (§2.4).

**No further corpus-validation cycle is planned.**

### 5.2 Standing rules

- Keep the PronounceAll convention (D4): `/ɹ/`, no length marks, `/i/` `/u/`, `/ɝ/`
  and `/ɚ/` as teaching units, atomic diphthongs, marks never clickable.
- **Cambridge** is a manual benchmark only: never scraped, never copied, and access
  controls are never bypassed.
- **`ipa-dict`** (`open-dict-data/ipa-dict`) stays documented as a future
  cross-validation and maintenance source. Any use must compare only after
  normalising to D4, never overwrite automatically, and record exact provenance and
  licence — using the per-pronunciation provenance of SDD §4.2 if it ever supplies a
  row.
- Multiple pronunciations: one primary, compact alternatives, no duplicates caused
  only by notation, and pronunciation-specific audio only (E4, D-R3-08; already in
  place).

---

## 6. Amendments required before Iteration 3 implementation — APPLIED 2026-09-17

Applied as listed, with two maintainer corrections: the "Broad en-US IPA" label is an
SRS acceptance criterion of FR-WORD-03, not only a Baseline item; and learner state has
three presentations (learned, not yet learned, and a default when state is unknown).

### 6.1 SRS

1. **FR-SAVE-03:** add `word_encounter` to the event types (target kind `word`, null
   value).
2. **FR-SAVE-04:** add `word_encounter` to the events excluded from derived state.
3. **New FR-SAVE-10 — Word encounter events:** what counts as an encounter; `word_id`
   only, never query text or referrer; who is recorded (§2.5 decision 1); write path
   (§2.5 decision 2); frequency (§2.5 decision 3); CSRF and idempotency per FR-SAVE-08.
4. **FR-AUTH-03:** unchanged under the recommended decision 1; otherwise amended to
   name the encounter write.
5. **FR-IPA-02:** add the learned-state presentation of §2.2 as an acceptance
   criterion: projection of FR-SAVE state, non-colour cue, neutral when unknown,
   marks uncoloured.
6. **FR-IPA-07 / FR-IPA-10:** learned count and learned styling on rows; the filter
   as a JavaScript enhancement.
7. **New FR-IPA-11 — Playback speed (Should):** `1×` / `0.75×` for whole-word and
   phoneme audio, including the Web Speech tier; client-side, not persisted
   server-side.
8. **Appendix F:** add the encounter `POST` to the CSRF-protected endpoints.
9. **Appendix E:** state that event log rows include word encounter history (which
   canonical words were viewed, and when) for learning history.
10. **NFR-PRIV-02:** no new retention class — encounter events follow the event-log
    rows; say so explicitly.

Already specified, no amendment: FR-SAVE-01/02/05/08, FR-WORD-06.

### 6.2 SDD v1.1

1. **§4.4:** `event_type` enum gains `word_encounter` (a new migration), and the
   derived-state exclusion list is updated.
2. **§3.4 and §5.3:** the encounter write is a separate `POST` after hydration; the
   hydration read stays read-only; the shell stays viewer-neutral.
3. **§5.3 hydration payload:** confirm it carries the per-phoneme saved state for
   every phoneme on the page (§3.4 already names it) and use it for the learned
   presentation; the same for `/learnIPA`.
4. **§5.1 merge and §5.5 deletion:** note that encounter events follow the existing
   event-log handling (LINK, hard-delete); there is no derived state to recompute.
5. **§4.8 indexing:** none for Iteration 3, which only writes. Iteration 5's history
   and eligibility queries add their index then.

### 6.3 Privacy documents

The Privacy Policy and Threat Model are not yet written (legal surface, later
iteration). NFR-PRIV-01 requires, before encounters are collected:

- **Appendix E** row wording (§6.1 item 9);
- a recorded obligation that the **Privacy Policy** discloses encounter history — what
  is stored, why, retention per NFR-PRIV-02, erasure per FR-SET-08, and inclusion in
  data-subject access exports;
- a recorded **Threat Model** entry for the encounter endpoint: CSRF, rate limiting,
  and that it stores no free text;
- **Cookie Table:** no change (`pa_uid` is already listed; no new cookie).

### 6.4 Frontend Design Baseline

1. **§4.1 colour:** a learned semantic token (from `--color-success`) and the neutral
   not-yet-learned token, with contrast checked against the page and hover states.
2. **§8.1 clickable IPA:** learned and not-yet-learned states for `.phoneme`,
   including the non-colour cue; hover, focus and expanded states take precedence.
3. **§8.3:** restate that marks are never state-coloured.
4. **§9 popover:** learned status text beside the save/tag control.
5. **§10 audio controls:** the `1×` / `0.75×` control — placement, accessible name,
   pressed state.
6. **§11 `/learnIPA`:** `M / N` progress, row learned styling, filter control.
7. **§7.4 pronunciation block:** the "Broad en-US IPA" label and accessible help
   disclosure (not a hover-only tooltip); record the existing "Pronunciation source"
   note for non-Wiktionary rows.
8. **§14:** promote "Future save/tag design" to the Iteration 3 design.

---

## 7. Competitor-learning rule

Learning from product ideas and public user feedback is fine (slower playback helps;
history alone is not active learning). Implementation must be original: never copy
source code, proprietary data, verbatim layouts, icons, text or unlicensed recordings.

---

## 8. Implementation guard

Before implementing anything here:

1. Read `DOC_INDEX.md`.
2. Confirm the §6 amendments are approved and merged into the authoritative documents.
3. Do not create tables, fields, endpoints or dependencies beyond those amendments.
4. Do not modify D4.
5. Keep Iteration 3 incremental and test-gated.
