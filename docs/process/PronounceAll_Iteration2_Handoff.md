# PronounceAll — Iteration 2 Handoff

**Version:** 1.0
**Date:** 2026-09-10
**Status:** Iteration 1 complete, verified, and committed. Iteration 2 not started.
**Purpose:** Start Iteration 2 (IPA system + audio) in a fresh chat without
re-deriving the state of the repository. Paste this file in first.

This document is a **router and a state-of-the-repo record**. It deliberately
does not restate requirements or design. Read the IDs it points at, in the
governing documents, per the retrieval policy in the root `CLAUDE.md`.

---

## 0. Read this before anything else — Iteration 2 has a hard prerequisite

**The D4 phoneme artifact does not exist in the repository.**

SDD v1.1 §4.2 and `D-R3-07` (§8) both name a *standalone phoneme example-word
artifact*, "D4", and make it — not the SDD, and not the schema — **authoritative**
for:

- the exact symbol set of the PronounceAll en-US Pedagogical IPA Inventory v1;
- its transcription conventions;
- the per-phoneme example words.

`docs/` contains no such file. It was verified absent on 2026-09-10:

```
docs/current/  Charter, SDD Round 1 Decisions, SDD v1.1,
               SRS Foundational Decisions, SRS Round 4 Decisions, SRS v1.0
docs/process/  Backlog and Findings, Handoff, SDD Handoff,
               Iteration 1 Handoff, Iteration 2 Handoff (this file)
```

This blocks the core of Iteration 2 and **must be resolved before the phoneme
seed is written**, because:

- `phonemes` carries `UNIQUE (variant_id, ipa_symbol)` and a **dense, unique
  `frequency_rank` 1..N per variant** (SDD §4.2). Both require the exact list.
- `D-R3-07` derives **41 teaching units** (24 consonants, 12 vowel and central
  rhotic units, 5 atomic diphthongs) as a *consequence of the documented list*.
  The count is not an independent constraint, so it cannot be used to
  reconstruct the list.
- The root `CLAUDE.md` invariant is explicit: *do not modify the approved
  canonical en-US pedagogical IPA inventory or its transcription convention
  without an explicit specification change.* Inventing the 41 symbols in code
  would be exactly that.

**Do not guess the inventory, and do not derive it from the Iteration 1 seed's
Wiktionary transcriptions.** Iteration 1 stores raw upstream IPA as text by
design (Iteration 1 Handoff §8.1); it is not normalised to any canonical
inventory and is not evidence of one.

**Required action, maintainer decision:** author D4 as
`docs/current/PronounceAll_Phoneme_Inventory_v1.md` before the seed work, or
explicitly authorise its authoring as the first task of Iteration 2 under review.
`D-R3-07` already fixes the *policy* the artifact must express — canonical `/ɹ/`,
five atomic diphthongs, compositional vowel-plus-R, `/ə/ /ʌ/ /ɝ/ /ɚ/` distinct,
`/ɔ/` retained — so authoring it is a documentation task governed by an approved
decision, not a new design decision. It still needs sign-off, and `DOC_INDEX.md`
§1 and §2 need a row when it lands.

Everything else in Iteration 2 that does not touch the phoneme inventory —
notably the audio pipeline and the `audio_assets` table — can proceed in
parallel.

---

## 1. Where the project stands

Phase 0 (documentation) is closed. The project is in the implementation phase,
working through the seven-iteration order fixed in
`docs/process/PronounceAll_Handoff_Document.md`.

**Iteration 0 — Foundation: done, committed.**
**Iteration 1 — Word pages: done, verified, committed (`5efd8fb`).**
**Iteration 2 — IPA system + audio is the next deliverable.**

The architecture is frozen. Do not redesign, and do not reopen resolved FIND
items or approved decisions.

---

## 2. What Iteration 1 added — the foundation you inherit

Reuse this rather than reinventing it. Iteration 0's inventory is in
`PronounceAll_Iteration1_Handoff.md` §2 and is all still current.

### Schema

`V3__word_catalogue.sql` created `words`, `word_pronunciations`, and
`word_requests`. Two columns are **deliberately staged** and are Iteration 2's
and the auth iteration's to complete (Iteration 1 Handoff §8.3):

| Staged | Owner | Action |
|---|---|---|
| `word_pronunciations.whole_word_audio_asset_id` + FK → `audio_assets` | **Iteration 2** | Add the column and the FK in the same migration that creates `audio_assets` |
| `word_requests.submitted_by_user_id` FK → `users` | auth iteration | Add the FK only; the nullable column already exists |

Still absent, correctly: `phonemes`, `phoneme_example_words`,
`pronunciation_phonemes`, `audio_assets`, `users`. Migrations start at `V4__`.

### Mechanisms Iteration 1 added — use these, do not write parallel ones

| What | Where | Notes |
|---|---|---|
| Word page shell | `src/routes/word.route.js`, `src/services/word-page.service.js`, `src/views/word.ejs` | The first `markCacheableShell` consumer (B2). Verified on the wire: `public, max-age=0, s-maxage=3600, swr=86400`, no `Set-Cookie`, nonce-free `'self'` CSP |
| Slug normalisation | `src/validators/word-slug.validator.js` | FR-WORD-02. 301 to canonical, 400 outside the allow-list |
| Fuzzy 404 | `src/services/word-suggestion.service.js` | E3: OSA + Double Metaphone. Ranked closeness → frequency → headword |
| Frequency ranks | `src/services/word-frequency.service.js` | Seed/content metadata from `data/seed/<variant>.frequency.json`, merged into the cached headword list. **NOT a database column** — SDD §4.2 is unchanged |
| Rate limiting | `src/middleware/rate-limit.js`, `src/lib/rate-limit-store.js` | Redis in staging/production, in-memory locally (NFR-SEC-11). `RATE_LIMITS` reproduces the Appendix C table — add a row per endpoint |
| Turnstile | `src/lib/turnstile.js` | Verifier port injected by the composition root. Token presence is enforced even when unconfigured |
| Transactions | `src/repositories/transaction.js` | Transaction scope belongs to the service operation |
| Ingestion pipeline | `scripts/fetch-wiktionary.js`, `scripts/seed-words.js`, `src/services/word-ingestion.service.js` | E1 staged fetch → normalise → validate → load. Idempotent upsert on natural keys |
| Cache purge seam | `src/lib/cache-purge.js` | Real adapter when configured; reports honestly when not. **Does not fake a purge** (§8.5) |
| Page-weight capture | `scripts/capture-word-page.js`, `.size-limit.json` | Renders the real word page so NFR-PERF-07 measures the document, not just assets |

### Content artifacts — committed, and deliberately so

`data/seed/` is the ONE exception to the `data/` ignore rule. `.gitignore` uses
`/data/*` + `!/data/seed/`, because a wholly excluded directory cannot have its
contents re-included.

| File | What |
|---|---|
| `en-us.raw.json` | Faithful copy of what Wiktionary served: 124 entries, `fetchedAt`, licence |
| `en-us.curation.json` | Every maintainer departure from upstream — IPA pins, skips, syllable-breakdown overrides — as reviewable committed data |
| `en-us.frequency.json` | 108 headword ranks from Wiktionary's TV/movie frequency lists, CC BY-SA 4.0 |

The load stage touches **no network**. That is what makes `npm run seed`
deterministic and reproducible (FR-CONTENT-01), and it is why CI can seed.

### Test baseline

87 unit + 55 integration (Jest/Supertest) + Playwright across chromium, firefox,
webkit and no-javascript. `npm audit` clean. `size-limit` at 4.42 kB against the
150 kB NFR-PERF-07 budget. CI has `lint`, `test`, `e2e`, `audit`, `secrets`,
`size`, `lighthouse`.

---

## 3. Conventions already fixed — do not relitigate

Everything in `PronounceAll_Iteration1_Handoff.md` §3 still holds. Two lessons
Iteration 1 paid for, worth carrying:

- **Never put a literal control character in a source file** — write the JS
  escape instead, never a raw NUL byte. A raw one makes Git classify the file as
  binary, so it cannot be diffed or merged. Iteration 1 shipped this in the
  FR-WORD-02 null-byte test; fixed in `d1d8fae`.
- **In an ESM test, `process.env.X = …` at the top of the file runs AFTER every
  static `import`.** A test that must configure the app before it loads has to
  use `await import(...)`. Iteration 1 shipped this bug and it hid a test that
  silently ran against the wrong store.

---

## 4. Iteration 2 scope

From the locked iteration order in `docs/process/PronounceAll_Handoff_Document.md`:

> **Iteration 2 — IPA system.** Clickable IPA symbols with phoneme popover
> (symbol + replay + example word). `phonemes` table seeded with the full
> canonical en-us pedagogical inventory + audio. `/:variant/learnIPA`
> (per-language) and `/learnIPA` (global) pages, both with frequency-ordered
> phoneme lists; in v1.0 they render identical content because en-us is the only
> seeded variant. Whole-word audio button with Wiktionary → AI TTS → Web Speech
> API fallback chain.

Concretely, six pieces of work:

1. **The phoneme schema and seed** — `phonemes`, `phoneme_example_words`,
   `pronunciation_phonemes`, `audio_assets`. **Blocked on §0.**
2. **Server-side IPA tokenization** — the seed resolves each transcription into
   an ordered `pronunciation_phonemes` sequence by longest-match, so the render
   path never reparses IPA.
3. **Clickable phonemes and the popover** — `data-phoneme-id` on the word page,
   completing FR-WORD-03.
4. **The audio pipeline** — Wiktionary human recording → Piper batch → Web Speech
   API, with provenance and integrity.
5. **The learnIPA pages** — `/:variant/learnIPA` and `/learnIPA`.
6. **Completing the staged migration** — `word_pronunciations
   .whole_word_audio_asset_id` and its FK.

---

## 5. Governing IDs — read these, and only these

Resolve through `DOC_INDEX.md` §3/§5 first. The minimum reading set:

### Requirements (SRS v1.0)

| ID | Covers |
|---|---|
| `FR-IPA-01` | Phoneme table coverage — the inventory is normative in the SDD, **see §0** |
| `FR-IPA-02` | Clickable phoneme elements, `data-phoneme-id` |
| `FR-IPA-03` | Phoneme popover content |
| `FR-IPA-04`, `NFR-PERF-06` | Phoneme audio playback latency |
| `FR-IPA-05` | Whole-word audio and the fallback chain |
| `FR-IPA-06` | Audio preload and lazy-load strategy (*Should*) |
| `FR-IPA-07`, `FR-IPA-10` | `/:variant/learnIPA` and global `/learnIPA` |
| `FR-IPA-08` | Example-word matching by SOUND, not spelling — **see FIND-01** |
| `FR-IPA-09` | IPA rendering fonts (*Should*) |
| `FR-WORD-03` | Completed this iteration: clickable phonemes + audio control |
| `FR-CONTENT-02` | Phoneme seed and audio assets |
| `FR-CONTENT-03` | TTS batch audio for whole-word fallback |
| `FR-CONTENT-04` | Audio asset integrity: digest, MIME, byte length, provenance |
| `FR-CONTENT-05`, `NFR-LEGAL-05` | Attribution — audio carries its OWN licence, distinct from the meaning's |
| `NFR-PERF-05` | The 50 ms shell budget now includes the phoneme joins |
| `NFR-PERF-07` | 150 KB word page; **200 KB** for both learnIPA pages |
| `NFR-A11Y-*` | The popover is the first real interactive control — keyboard and two-modality operation |

### Design (SDD v1.1 + Round 1 Decisions)

| ID | Covers |
|---|---|
| `D-R3-07` | The canonical inventory policy. **The authority for the list itself is D4 — see §0** |
| `E2` | Phoneme example-word artifact and the FIND-01 fix |
| `E1` | Seed pipeline — extend it, do not write a second one |
| `V1` | Piper `en_US-libritts-high`, run as a SEPARATE BATCH TOOL, never linked into the app. Documented licensing residual |
| `V4` | Audio on local disk, served by Nginx, content-addressed immutable filenames, behind a **storage port** — an adapter, not `repositories/` |
| `C6` | Background job model; the `audio_assets` `UNIQUE (asset_key)` + `generation_status` compare-and-set is the TTS idempotency mechanism |
| SDD §4.2 | `phonemes`, `phoneme_example_words`, `pronunciation_phonemes`, `audio_assets` — read each table's own subsection |
| SDD §4.8 | Indexing: the `pronunciation_phonemes` PK `(pronunciation_id, position)` ordered join; `phonemes (variant_id, frequency_rank)` for the learning pages |
| SDD §4.12 | **Secondary-pronunciation audio is RESOLVED and closed.** A secondary pronunciation gets a control only when an asset corresponds to that specific pronunciation; primary audio is never reused for it; Web Speech is never presented as a specific secondary pronunciation |
| SDD §5.3 | Flow 3, the audio branch and the fallback chain |
| SDD §6.3 | Audio is `public, max-age=31536000, immutable` and is NEVER invalidated — a changed asset is a new filename |

### Registers

- `FIND-01` — the FR-IPA-08 "must begin with the phoneme" criterion is impossible
  for phonemes such as `/ŋ/` and `/ʒ/`. **Status: Scheduled, to be fixed before
  the Iteration 2 seed validation test.** E2 supplies the corrected rule: the
  phoneme must appear SOMEWHERE in the example's phonemic transcription,
  preferring word-initial where the phoneme permits.
- `FIND-09` — the Appendix C `GET` word-page scraping limit, deferred to the
  Cloudflare/WAF deployment work. **Not Iteration 2's.** Do not implement
  origin-side UUID limiting for cached word-page `GET`s.

---

## 6. Invariants Iteration 2 must not break

- **Browser JavaScript must never linguistically parse IPA.** Tokenization is a
  seed-time, server-side concern; the browser only reads `data-phoneme-id`.
  This is a root `CLAUDE.md` invariant.
- **Do not add `phonemes.is_active` or `word_pronunciations.source_ipa.`**
  Explicitly rejected for v1.0 (SDD §4.12). Raw upstream IPA lives in the
  ingestion artifact, not a runtime column.
- **The word page shell stays a shell.** Adding audio and popovers must not
  introduce inline `<script>`/`<style>`, a per-request nonce, or a `Set-Cookie`
  on that response. The e2e test `B2 — the cacheable shell on the wire` guards
  this; keep it passing.
- **Reading still works with JavaScript disabled.** FR-IPA-05 requires audio to
  fall back to a native `<audio controls>` without JS; phoneme elements stay
  visible text that simply does not respond to clicks.
- **`phonemes.primary_example_word_id` is nullable at INSERT only**, to break the
  circular reference with `phoneme_example_words`. The seed transaction inserts
  the phoneme, then its examples, then sets the pointer, and the validator
  asserts non-null at completion. It is a seed invariant, never a runtime state.
- **The vowel-plus-R rule.** `/ɑɹ/` in `car` tokenizes to TWO rows, `/ɑ/` then
  `/ɹ/`. The five diphthongs are single atomic rows.
- **`pa_seed` writes content; `pa_app` only reads it** (SDD §4.9). The grants are
  deployment work, but do not design anything that needs the runtime role to
  write a catalogue table.

---

## 7. Running and verifying

```bash
docker compose up -d mysql redis
npm run migrate              # Flyway
npm run seed                 # loads data/seed/, no network
npm run dev                  # http://localhost:3000/en-us/cupcake
```

To refresh content: `npm run fetch:wiktionary` (entries + ranks), or
`node scripts/fetch-wiktionary.js --frequency-only` for ranks alone.
`npm run seed:dry-run` validates and diffs without writing.

The gate, all of which must pass:

```bash
npm run lint             # architecture + SQL rules
npm run lint:licence     # NFR-LEGAL-03
npm test                 # unit + integration
npm run test:e2e         # Playwright, 4 projects
npm run size             # NFR-PERF-07
npm audit --audit-level=high --omit=dev
```

**Known local-environment issue, not a product defect.** On Windows, running all
four Playwright projects in parallel can exhaust memory
(`FATAL ERROR: Zone Allocation failed`), and Firefox can fail in
`browserContext.close()` with a `_maybeDontRestoreTabs` protocol error *after*
its assertions have passed. Run serially — `--project=<name> --workers=1` — and
let Linux CI be the authoritative parallel check. **Do not change product code or
Iteration 0/1 tests to work around it.**

Test the invariants, not the happy path: the seed's exactly-one-primary and
non-null example pointer, tokenization of vowel-plus-R and of the diphthongs,
the `audio_assets` claim under concurrency (two workers must not both generate),
digest and byte-length integrity, the no-JavaScript audio fallback, popover
keyboard operation, and the shell's headers after audio lands.

---

## 8. Definition of done for Iteration 2

- [ ] D4 exists, is approved, and is routed in `DOC_INDEX.md` (**§0**)
- [ ] `phonemes` holds exactly the canonical inventory for `en-us`, with a dense
      unique `frequency_rank`, and every row has audio and a non-null
      `primary_example_word_id`
- [ ] Every `phoneme_example_words` row passes the corrected FR-IPA-08 check
      (E2, FIND-01), and FIND-01 moves to Applied
- [ ] `pronunciation_phonemes` is populated by server-side longest-match
      tokenization; no IPA parsing happens at render or in the browser
- [ ] Word-page IPA is clickable, each unit carrying `data-phoneme-id`; the
      popover shows symbol, replay, and example word
- [ ] Whole-word audio works with the FR-IPA-05 fallback chain, degrading to
      native `<audio controls>` without JavaScript
- [ ] Secondary-pronunciation audio follows SDD §4.12 exactly
- [ ] `word_pronunciations.whole_word_audio_asset_id` and its FK are added
- [ ] Every audio asset has a digest, MIME type, non-zero length, and full
      provenance; attribution is rendered per its own licence
- [ ] `/:variant/learnIPA` and `/learnIPA` render frequency-ordered lists within
      the 200 KB NFR-PERF-07 budget
- [ ] Zero axe-core violations, including the popover; NFR-PERF-05 still met
- [ ] Full gate green
- [ ] Completion report per root `CLAUDE.md` §11

---

## 9. Rules of engagement for the next chat

1. Start at `DOC_INDEX.md`. Never read an SRS/SDD end to end.
2. State the governing requirement and decision IDs before substantial coding.
3. **Resolve §0 before writing the phoneme seed.** Do not invent the inventory.
4. If two authoritative sources conflict and the SDD §6 amendment ledger does not
   explain it — stop and report. Do not pick a side.
5. Keep diffs narrow. No unrelated refactoring, renaming, or reformatting.
6. Do not modify anything in `docs/current/` during an implementation task —
   except authoring D4, and only once §0 is explicitly authorised.
7. Run `git status` before and after. Never commit, push, or reset unless asked.
8. If a check cannot run locally, report the exact command and blocker rather
   than silently skipping it.
