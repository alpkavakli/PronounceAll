# PronounceAll — Session Handoff, 2026-09-11

**Purpose:** Resume work in a fresh chat without re-deriving the state of the
repository. Paste this file in first.

**Status at handoff:** working tree clean, everything committed, gate green.
Head is `e71800e`.

---

## 0. The one decision that is blocking

**Iteration 2 cannot close until you choose a phoneme audio source.**

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

Three options, all of which the finished infrastructure supports — only the
producer function differs:

1. **Piper for all 41** (decision V1, the already-chosen TTS path). Uniform,
   regenerable, clean provenance. Needs the Piper batch built and run.
2. **Commons where available, Piper for the remaining 7.** Better audio, mixed
   provenance, two licences to attribute.
3. **Commons plus word exemplars for the diphthongs**, explicitly labelled as
   exemplars. Cheapest, but changes what a click means.

Full detail: `docs/process/PronounceAll_Iteration2_Completion.md` §3.

---

## 1. Where the project stands

| Iteration | State |
|---|---|
| 0 — Foundation | done, committed |
| 1 — Word pages | done, approved, committed |
| 2 — IPA system + audio | data layers, tokenizer, clickable IPA, learning pages **done**; **audio not done** (§0) |
| 3 — Save/tag | not started. **Do not begin without asking.** |

Phase 0 (documentation) is closed. Architecture is frozen. The default task is
to implement the existing specification faithfully.

### Commits this session

```
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
| `audio_assets` | 41, **all pending** |

Migrations `V1`–`V5` applied. Next is `V6__`.

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
npm run lint:licence     # NFR-LEGAL-03, 89 files
npm run inventory:check  # D4 drift
npm test                 # 140 unit + 131 integration
npm run test:e2e         # run per project, --workers=1 locally
npm run size             # NFR-PERF-07
npm audit --audit-level=high --omit=dev
```

Last full run: lint clean, licence 89 files, inventory matches, **140 unit**,
**131 integration**, chromium **54**, webkit **54**, no-javascript **34**, size
**6.79 kB** against 150 kB, audit clean.

---

## 8. Suggested next steps, in order

1. **Decide the phoneme audio source** (§0). Everything else in Iteration 2 is
   downstream of it.
2. **Build the producer** for that choice — the Piper batch under C6, or the
   Commons ingest. `src/services/audio-asset.service.js` already has
   claim/produce/verify; only the `produce` function is missing.
3. **Generate the 41 assets.** Every phoneme's asset reaches `ready`, the popover
   replay control and the learning-page audio appear on their own.
4. **Whole-word audio and the FR-IPA-05 fallback chain**, honouring SDD §4.12:
   a secondary pronunciation gets a control only when an asset matches THAT
   pronunciation; primary audio is never reused for it; Web Speech is never
   presented as pronunciation-specific secondary audio.
5. **Re-run the FR-CONTENT-04 integrity check** once assets exist.
6. **Close Iteration 2** and write its completion report.

Optional, unblocked, small: `FR-IPA-09`'s web-delivered font. The system half of
the stack is in place; the remaining half is a real decision about family,
licence, subsetting, and page weight.

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
