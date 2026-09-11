# PronounceAll — Session Handoff, 2026-09-11

**Purpose:** Resume work in a fresh chat without re-deriving the state of the
repository. Paste this file in first.

**Status at handoff:** working tree clean, everything committed.
Head is `394481d`.

> **UPDATE, later on 2026-09-11 — SECTION 0 IS RESOLVED.**
>
> The audio source decision was made (option 1, Piper for all 41), the
> generation input was approved by the maintainer, and **all audio is now
> generated**: 41 canonical phoneme assets and 6150 whole-word assets, 6191
> ready and verified in total. `npm run audio:verify` PASSES.
>
> The FR-IPA-05 fallback chain, the Web Speech tier 3, the "Audio unavailable"
> state and the FR-IPA-06 preload behaviour are all implemented.
>
> **The only thing left before Iteration 2 can close is a maintainer LISTENING
> PASS over the generated audio.** That is QA on content, not another design
> decision. See section 10.
>
> Section 0 below is kept as the record of how the decision was reached. Do not
> act on it as if it were still open.

---

## 0. The decision that was blocking (RESOLVED 2026-09-11)

**~~Iteration 2 cannot close until you choose a phoneme audio source.~~**

All 41 `audio_assets` rows exist and are `pending`. No audio file exists. They
are real, licensed rows with deterministic keys — nothing fabricated a digest, a
length, or a file, and a check constraint refuses a `ready` row without them.

Because of that, and by the rule this project applies everywhere (*a control
that cannot work is worse than none*):

- the phoneme popover renders symbol and example word but **hides** its replay
  control;
- no `<audio>` element renders on any word page or learning page.

`FR-CONTENT-02`, `FR-IPA-04`, `FR-IPA-05`, `FR-IPA-06` and `NFR-PERF-06` are
therefore **not satisfied**.

A survey was run against Wikimedia Commons on 2026-09-11:

- **34 of 41** units have an isolated-articulation recording under CC BY-SA 3.0
  with author metadata (`Voiceless_bilabial_plosive.ogg` for `/p/`, and so on);
- **`w`, `ɝ`, `ɚ`** have no such file under the obvious names;
- the **five diphthongs** have no isolated recording at all — the only Commons
  candidates are whole-WORD recordings (`En-us-eight.ogg`), so clicking `/eɪ/`
  would play the word "eight". Mixing those in unannounced would be the same
  class of problem as fake audio, so it was not done.

Three options were considered:

1. **Piper for all 41** (decision V1, the already-chosen TTS path). Uniform,
   regenerable, clean provenance. Needs the Piper batch built and run.
2. **Commons where available, Piper for the remaining 7.** Better audio, mixed
   provenance, two licences to attribute.
3. **Commons plus word exemplars for the diphthongs**, explicitly labelled as
   exemplars. Cheapest, but changes what a click means.

**Correction (2026-09-11).** An earlier draft of this section said the finished
infrastructure supports all three and that "only the producer function differs."
That is wrong, and it understated options 2 and 3. `assetKeyFor()` embeds
`sourceKind` in the key, so a Commons unit has a *different* `asset_key` than the
Piper row already registered for it; `registerAsset` upserts on `asset_key`, so
the 34 existing `pending` rows would not be updated but left behind and would
need explicit cleanup. `source_kind` is also an `ENUM('wiktionary_human',
'tts_piper','tts_cloud')`, and a Commons isolated-articulation recording is not a
Wiktionary word recording, so options 2 and 3 need either a `V6` migration
extending the ENUM or a deliberate decision to file them under
`wiktionary_human`. They are a migration plus a re-seed plus per-row licence,
author and `source_reference` plumbing — not a producer swap.

**Decision (2026-09-11): option 1, Piper for all 41.** Options 2 and 3 are not to
be implemented. Rationale: one consistent voice across the inventory, no `V6`
migration, no stale rows or mixed provenance, and clicking a phoneme keeps
meaning "the teaching sound" rather than a whole example word. Human-recorded
phoneme audio may be revisited after v1 if Piper quality proves inadequate.

Full detail: `docs/process/PronounceAll_Iteration2_Completion.md` §3.

---

## 1. Where the project stands

| Iteration | State |
|---|---|
| 0 — Foundation | done, committed |
| 1 — Word pages | done, approved, committed |
| 2 — IPA system + audio | **code complete.** Data layers, tokenizer, clickable IPA, learning pages, phoneme audio, whole-word audio, the FR-IPA-05 chain and FR-IPA-06 preload are all done. Closing needs only the maintainer listening pass (§10) |
| 3 — Save/tag | not started. **Do not begin without asking.** |

Phase 0 (documentation) is closed. Architecture is frozen. The default task is
to implement the existing specification faithfully.

### Commits this session

```
394481d feat: whole-word audio and the FR-IPA-05 fallback chain (FR-CONTENT-03)
da79278 feat: generate the 41 canonical phoneme audio assets with Piper
ec808d1 docs: add the proposed frontend design baseline (NOT authoritative yet)
afaa7af fix: make audio generation re-runnable, and unbreak learnIPA once audio exists
b4b6060 docs: session handoff, and add the missing fetch:headwords script
e71800e feat: the phoneme learning pages (FR-IPA-07, FR-IPA-10)
d37ce61 feat: put the search box on the word and unknown-word pages
9eff7e4 feat: word search, and expand the dictionary to 6150 headwords
5a96248 feat: Iteration 2 — IPA system, tokenizer, and clickable phonemes
ab5c139 docs: add D4, the approved en-US pedagogical IPA inventory
752bcb0 docs: add the Iteration 2 implementation handoff
d1d8fae fix: escape the NUL byte in the slug validator test
5efd8fb feat: Iteration 1 — word pages
```

---

## 2. What exists and works

Run it:

```bash
docker compose up -d mysql redis
npm run migrate
npm run dev            # http://localhost:3000
```

| URL | What |
|---|---|
| `/` | Landing page with the search box |
| `/en-us/cupcake` | Word page: meaning, IPA as clickable phonemes, syllable/stress, attribution |
| `/en-us/learnIPA` | The 41 canonical units ranked by corpus frequency, with example words |
| `/learnIPA` | Cross-variant index, footer-linked only |
| `/search?q=gorgeus` | Exact match redirects; near match ranks; no match offers the request form |
| `/en-us/cuppcake` | Fuzzy 404 suggesting `cupcake`, with the word-request form |
| `/health` | JSON liveness |

### Database state

| Table | Rows |
|---|---|
| `words` | 6 150 |
| `word_pronunciations` | 7 531 |
| `phonemes` | 41 |
| `phoneme_example_words` | 41 |
| `pronunciation_phonemes` | 39 896 |
| `audio_assets` | 6 191, **all ready** (41 phoneme + 6 150 whole-word) |

Migrations `V1`–`V5` applied. Next is `V6__`. No migration was needed for the
audio work.

Generated audio lives in `data/audio/`, which is **gitignored**. A fresh clone
has no audio until `npm run audio:generate` and `npm run audio:generate:words`
are run. Note that Piper's VITS sampling is stochastic, so regenerating produces
DIFFERENT bytes and therefore different content-addressed keys — the profile
pins the generator's identity, not the output's.

---

## 3. Architecture notes that are easy to get wrong

These cost real debugging time this session. Read before touching the areas.

**Router order is load-bearing.** `/:variant/learnIPA` is indistinguishable from
`GET /:variant/:word`. `learnIpaRouter()` MUST stay registered before
`wordRouter()` in `src/app.js` or the learning page is looked up as a word and
404s. A test in `tests/integration/learn-ipa.test.js` pins it. `/search` was
deliberately given a top-level URL to avoid the same trap; FR-IPA-07 fixes the
learnIPA URL so it could not be avoided there.

**Express matches paths case-insensitively.** `/en-us/learnipa` reaches the
learnIPA route and would serve the page under a second URL. Differently-cased
paths now 301 to the canonical spelling.

**Any column that can hold an IPA symbol needs `utf8mb4_0900_as_cs`.** Under the
default accent-insensitive collation `ð` compares EQUAL to `d`. That shipped
briefly: `audio_assets.asset_key` embeds the symbol, so `/d/` and `/ð/` shared
one audio row and would have played the same sound. Fixed by `V5`. Applies to
composite keys, not just bare symbol columns.

**The D4 gate lives in the loader.** `word-ingestion.service.js` runs every
transcription through the frozen tokenizer before it can be written, so
`word_pronunciations` is correct at every moment rather than after a later pass.
One unsupported variant costs only that variant; a word is dropped only when
nothing survives. Evidence it works: the Iteration 2 reconciliation pass reports
**0 rewritten, 0 removed** over 7 531 pronunciations.

**Seed stage order is deliberate and not the obvious one.** `seed-phonemes`
reconciles, THEN seeds, THEN populates occurrences — because D4 §6 derives
`frequency_rank` from the *supported* corpus, so ranking before reconciliation
would count rows about to be deleted.

**Never write a literal control character into a source file.** Use the JS
escape. A raw NUL makes Git classify the file as binary — it happened twice this
session (`d1d8fae`, and again in a doc that was caught before commit).

**Heredocs mangle backslashes.** Writing JS/regex through `bash <<'PY'` turned
`\b` into a literal backspace and `\\n` into a newline more than once. Use the
Edit or Write tool for anything containing escapes.

---

## 4. Known issues

**Firefox e2e fails locally, on this Windows machine only.** Every spec,
including untouched Iteration 0/1 ones, fails at
`browserContext.close: Protocol error … _maybeDontRestoreTabs`, often followed by
a 30 s timeout. Assertions pass; teardown crashes. It degraded during the
session — Firefox passed 25/25 earlier the same day. Chromium, WebKit and the
no-JavaScript profile all pass in full.

**Standing instruction: do not alter product code or tests to work around it.**
Linux CI is the authoritative parallel-environment check. Run projects serially
locally: `npx playwright test --project=chromium --workers=1`.

**Update, later on 2026-09-11:** Firefox ran clean, 55/55, serially on this same
machine. The teardown crash did not reproduce. Treat it as intermittent rather
than fixed; the standing instruction above is unchanged.

---

## 5. Documentation debt — three open register entries

In `docs/process/PronounceAll_Backlog_and_Findings.md`:

**FIND-09 — Appendix C `GET` word-page scraping limit.** Deferred to the
Cloudflare/WAF deployment work, approved. Enforcing it at the Express origin
would make the shared shell depend on per-viewer identity and would miss every
cache hit. **Do not implement origin-side per-UUID limiting for cached word-page
GETs.**

**FIND-10 — Word search exists in the product but not the specification.** Built
on maintainer instruction ahead of the SRS. Owed: an FR in §4.1 (provisionally
`FR-WORD-11`), an Appendix F row for `GET /search`, a rate-limit decision (it is
currently unlimited — an in-memory scan over the cached headword list), and an
API Specification note.

**FIND-11 — Dictionary expanded to 6 150 words.** Two consequences recorded:
`FR-WORD-04`'s `xqzzy` example has gone stale (against 6 150 words it is close
enough to `sexy` to be suggested — the matcher working, not failing; tests use
`qxzjvwkmpf` and E3 is untouched), and a coverage tripwire now exists.

None of these are code defects. They are specification catch-up.

**Frontend Design Baseline — PROPOSED, not authoritative.**
`docs/current/PronounceAll_Frontend_Design_Baseline_v1.md` is new and untracked.
It is marked *"Proposed owner baseline — freeze after maintainer approval"*, it is
NOT in `DOC_INDEX.md`'s authority table, and by maintainer instruction it stays
that way for now: **do not treat it as governing, and do not redesign existing
pages from it.** It will be approved and frozen separately, and only then routed
in `DOC_INDEX.md`.

One thing to reconcile when it is: its §10 says not to use the native
`<audio controls>` strip in the primary word/pronunciation UI once a custom
control exists, while `src/views/word.ejs` uses it deliberately as the FR-IPA-05
no-JavaScript baseline. Not a conflict today — §10 conditions itself on a custom
control existing — but the two must be reconciled before §10 is frozen.

---

## 6. Content pipeline

Everything is committed under `data/seed/`, so the load stages touch **no
network**.

| File | What | Size |
|---|---|---|
| `en-us.headwords.json` | 9 702 frequency-ranked headwords, selection source only | 547 KB |
| `en-us.raw.json` | 8 000 fetched Wiktionary entries | 5.6 MB |
| `en-us.frequency.json` | Ranks for the seeded headwords | 130 KB |
| `en-us.curation.json` | Every maintainer departure from upstream | 8 KB |
| `en-us.phonemes.json` | The 41 canonical units, DERIVED from D4 | 12 KB |

```bash
npm run fetch:headwords     # ranked source, network
npm run fetch:wiktionary    # entries, network, ~4 min, batches of 50
npm run seed                # words, offline, ~30 s
npm run seed:phonemes       # inventory + occurrences, offline, ~1.7 min
npm run inventory:check     # fails if the artifact drifts from D4
```

`data/seed/` is the one exception to the `data/` ignore rule — `.gitignore` uses
`/data/*` plus `!/data/seed/`, because a wholly excluded directory cannot have
its contents re-included.

**Yield, for planning:** of 8 000 requested headwords, 6 150 load. Of the 1 850
that do not, ~1 066 have no identifiable American transcription, ~919 are
inflected "form-of" entries with no independent definition (`went`, `said`), and
~35 fail D4 canonical validation. All reported, none hidden.

---

## 7. The gate

```bash
npm run lint             # architecture + SQL rules; the build enforces C4
npm run lint:licence     # NFR-LEGAL-03, 100 files
npm run inventory:check  # D4 drift
npm run audio:preflight  # voice/model/speaker drift, before generating anything
npm run audio:verify     # FR-CONTENT-02/04 integrity and canonical coverage
npm test                 # 177 unit + 158 integration (integration runs serially)
npm run test:e2e         # run per project, --workers=1 locally
npm run size             # NFR-PERF-07
npm audit --audit-level=high --omit=dev
```

Last full run (2026-09-11, after all audio was generated): lint clean, licence
100 files, inventory matches, **177 unit**, **158 integration**, chromium **59**,
webkit **59**, no-javascript **34 passed / 25 skipped**, size **7.32 kB** against
150 kB, audit clean, `audio:verify` **PASS** — 41/41 canonical units, 6 191
assets checked, zero missing files, zero digest mismatches.

**Integration tests now run with `--runInBand`.** They share one database: some
suites insert fixture rows, others assert corpus-wide invariants, and a few
mutate a real row and restore it. In parallel those overlap and the failure
lands on whichever suite read mid-flight. See the comment in `jest.config.js`.

**Firefox, this session:** it passed 55/55 twice early on, then degraded to the
documented teardown flake. Every one of the 36 failures was the same
`browserContext.close` protocol error and there were **zero assertion failures**.
Unchanged standing instruction: do not work around it; Linux CI is authoritative.

**Correction to the previous entry.** It recorded chromium **54** / webkit **54**
/ no-javascript **34** and called the gate green. Those were the PASSING counts;
one test was failing and was not recorded. `tests/e2e/word-page.spec.js` still
asserted `[data-phoneme-id]` count **0**, an Iteration 1 statement that Iteration 2
superseded when it made phonemes clickable (FR-IPA-02). It has been corrected to
assert presence, with the interaction itself left to
`phoneme-interaction.spec.js`. Do not read the earlier "gate green" line as
evidence that a clean e2e run existed at `e71800e`.

---

## 8. Suggested next steps, in order

Steps 1 to 6 of the previous list are **done**: the audio source was decided, the
generation input was approved, the producer was built, all 6 191 assets were
generated and verified, and the FR-IPA-05 chain and FR-IPA-06 preload were
implemented. What remains:

1. **The maintainer listening pass (§10).** The only thing between here and
   closing Iteration 2. It is content QA, not a design decision.
2. **Decide what happens to a rejected clip.** There is no supported way to
   replace one today (§10). Build that path only if the listening pass needs it.
3. **Close Iteration 2** and write its completion report.

Still open, and unchanged by this session:

- **FIND-09 / FIND-10 / FIND-11** documentation debt (§5).
- **The frontend design baseline** is PROPOSED and not authoritative (§5). Review,
  approve, freeze, and only then route it in `DOC_INDEX.md`.
- `FR-IPA-09`'s web-delivered font: optional, unblocked, small. The system half
  of the stack is in place; the rest is a real decision about family, licence,
  subsetting, and page weight.
- **Wiktionary human recordings (FR-IPA-05 tier 1)** were never ingested — no
  `wiktionary_human` asset exists. Every word currently plays Piper TTS. Tier 1
  is a content-pipeline addition, not a code change: when those assets land the
  word batch simply finds less to do.

**Do not begin Iteration 3 without asking.**

---

## 9. Rules of engagement

1. Start at `DOC_INDEX.md`. Never read an SRS/SDD end to end.
2. State the governing requirement and decision IDs before substantial coding.
3. If two authoritative sources conflict and the SDD §6 ledger does not explain
   it — stop and report. Do not pick a side.
4. Keep diffs narrow. No unrelated refactoring or reformatting.
5. Do not modify `docs/current/` during an implementation task. D4 is frozen;
   `FIND-07` and the 41-unit inventory are not to be reopened.
6. Run `git status` before and after. Never commit, push, or reset unless asked.
7. If a check cannot run locally, report the exact command and blocker rather
   than skipping it silently.
8. Never fabricate content to make a constraint pass — no placeholder audio, no
   invented pronunciations, no coerced IPA.

---

## 10. The listening pass — the one thing left for Iteration 2

The audio is generated, verified and wired up. What no automated check can
assert is whether a clip is the RIGHT sound. The output checks are deliberately
mechanical — decodable, correct format, non-empty, non-silent — and none of them
claims pedagogical correctness.

**How to listen.** `npm run dev`, then open `http://localhost:3000/en-us/learnIPA`.
All 41 units render with a play control, in frequency order. Word audio is on
any word page, e.g. `/en-us/cupcake`.

**Start with `/ɑ/`.** Its stored clip is 0.081 s, the same length as the shortest
plosive and about a fifth of the vowel mean (0.379 s). Five fresh runs of the
same input gave 0.197–0.522 s, so this is an unlucky draw at the short tail of
Piper's stochastic duration predictor rather than a mapping error.

Durations by category, for orientation:

| Category | Mean | Shortest | Longest |
|---|---|---|---|
| consonant | 0.214 s | `f` 0.070 | `dʒ` 0.395 |
| vowel | 0.379 s | **`ɑ` 0.081** | `i` 0.522 |
| central rhotic | 0.401 s | `ɚ` 0.244 | `ɝ` 0.557 |
| diphthong | 0.504 s | `oʊ` 0.395 | `aɪ` 0.604 |

**There is currently no supported way to replace a single bad clip.** `ready` is
immutable under V4 and `claimForGeneration` refuses a `ready` row, so
regenerating one means deliberately resetting that row first. If the listening
pass rejects clips, that operator path is the next thing to build — it was not
invented speculatively.
