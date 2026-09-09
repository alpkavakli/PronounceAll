# PronounceAll — Iteration 1 Handoff

**Version:** 1.0
**Date:** 2026-09-09
**Status:** Iteration 0 complete and committed. Iteration 1 not started.
**Purpose:** Start Iteration 1 (Word pages) in a fresh chat without re-deriving
the state of the repository. Paste this file in first.

This document is a **router and a state-of-the-repo record**. It deliberately
does not restate requirements or design. Read the IDs it points at, in the
governing documents, per the retrieval policy in the root `CLAUDE.md`.

---

## 1. Where the project stands

Phase 0 (documentation) is closed. SRS v1.0 and SDD v1.1 are complete and live
under `docs/current/`. The project is in the implementation phase, working
through the seven-iteration order fixed in
`docs/process/PronounceAll_Handoff_Document.md`.

**Iteration 0 — Foundation is done, verified, and committed to `main`.**
**Iteration 1 — Word pages is the next deliverable.**

The default task is to implement the existing specification faithfully. The
architecture is frozen. Do not redesign, and do not reopen resolved FIND items
or approved decisions.

---

## 2. What Iteration 0 built — the foundation you inherit

All of the following is committed, running, and covered by tests. **Reuse it
rather than reinventing it.**

### Runtime

Server-rendered EJS on Express 5, Node 22+, ESM (`"type": "module"`).
MySQL 8.4 (raw parameterised SQL via `mysql2`, no ORM), Redis 7, Flyway for
migrations, all in `docker-compose.yml`.

### Layer map (C4 — this is the enforced structure)

```
src/routes/        thin HTTP handling          src/lib/       shared infra clients
src/services/      domain logic, no Express    src/views/     EJS templates
src/repositories/  all SQL, nothing else       src/public/    browser JS + CSS
src/middleware/    cross-cutting request work  src/workers/   (empty, Iteration 6+)
src/validators/    (empty — Iteration 1 fills) src/jobs/      (empty, Iteration 6+)
src/errors/        AppError + stable codes     src/config/    validated env
migrations/  scripts/  tests/{unit,integration,e2e}
```

`src/app.js` is the composition root — the one module allowed to know every
layer. `src/server.js` owns the process lifecycle only.

### Mechanisms already in place — use these, do not write parallel ones

| What | Where | Notes |
|---|---|---|
| `AppError`, stable codes, factories | `src/errors/app-error.js` | `validation` `auth` `forbidden` `notFound` `conflict` `rateLimit` `internal`. Services throw, never format responses |
| One error middleware, two surfaces | `src/middleware/error-handler.js` | HTML → `views/errors/error.ejs`; JSON → `{error:{code,message,correlationId}}`. **Surface is route-level**: `router.get(path, jsonErrorSurface(), handler)`. Never `router.use(jsonErrorSurface())` — a prefix-less router marks every request |
| Response classes + cache headers | `src/middleware/response-class.js` | `markCacheableShell(res)` / `markHydration(res)` / default DYNAMIC. **`markCacheableShell` exists and is currently unused — Iteration 1 is its first consumer (B2)** |
| CSP + security headers | `src/middleware/security-headers.js` | Nonce-free `'self'` policy on SHELL responses, per-request nonce on everything else (amended NFR-SEC-03) |
| `pa_uid` anonymous identity | `src/middleware/anonymous-identity.js` | Issues/slides only on non-SHELL responses. `req.anonymousId` (nullable), `req.ensureAnonymousId()` |
| localStorage mirror + rehydration | `src/public/js/bootstrap.js` | FR-AUTH-02. **The mirror wins over a freshly-issued cookie** — unchanged this iteration (§8.7) |
| Logger + PII redaction | `src/lib/logger.js` | pino, `REDACTED_PATHS` backstop. Never `console`. Correlation id threaded from `request-context.js` |
| Config | `src/config/index.js` | **The only module allowed to read `process.env`.** Zod-validated, fails fast in staging/production |
| CSPRNG ids | `src/lib/ids.js` | `generateSecureToken` (≥128 bit), `generateAnonymousId` (UUID v4, the documented NFR-SEC-12 exception), `generateCorrelationId` |
| DB pool / Redis client | `src/lib/mysql.js`, `src/lib/redis.js` | UTC session time zone enforced (C5) |

### The lint gate enforces the architecture

`npm run lint` **fails the build** on: a route importing a repository or `lib/`,
a repository importing a service, a business service importing a concrete infra
client from `lib/`, interpolated or concatenated SQL in `.query()`/`.execute()`,
and any use of `Math.random`. These were verified against deliberate violations.
If the lint complains, the code is wrong — not the rule.

`npm run lint:licence` enforces NFR-LEGAL-03: every `.js` `.mjs` `.cjs` `.ejs`
file carries the SPDX header. New files need it.

### Schema as it exists today

Only **`language_variants`** exists (`V1__initial_schema.sql`), seeded with
`en-us` (`V2__seed_language_variants.sql`).

The rule applied was **no table ships ahead of its code**. Every other table in
SDD §4.2–§4.7 is still unwritten. Iteration 1 creates the ones it needs.

### Routes that exist

`GET /` (landing page), `GET /health` (JSON liveness), static assets, and a
catch-all 404 through the error taxonomy. That is all.

### Test baseline

32 unit + 17 integration (Jest/Supertest) + 26 e2e (Playwright: Chromium,
Firefox, WebKit, and a no-JavaScript project) + 2 correctly skipped. All green.
`npm audit` clean. CI workflow in `.github/workflows/ci.yml`.

---

## 3. Conventions already fixed — do not relitigate

- Files kebab-case with a layer suffix: `word-page.service.js`,
  `words.repository.js`. One primary responsibility, one primary export.
- `camelCase` identifiers, `PascalCase` classes, `SCREAMING_SNAKE_CASE`
  constants and error codes.
- SQL `snake_case`, plural tables, singular columns. All temporal columns UTC.
- Migrations `V<n>__<description>.sql`. **An applied migration is immutable** —
  a correction is a new migration. Flyway's checksum guards this.
- Transaction scope belongs to the service operation, not the repository.
- EJS escapes by default (`<%= %>`); `<%- %>` only for static or sanitised
  content.
- Views carry no inline `<script>` or `<style>` — required for the shell to take
  the nonce-free CSP.
- Reading must work with JavaScript disabled. Interaction layers on top.
- Client JS is plain ES modules, no framework. CSS hand-written, Flexbox first.

---

## 4. Iteration 1 scope

From the locked iteration order in `docs/process/PronounceAll_Handoff_Document.md`:

> **Iteration 1 — Word pages.** `GET /:variant/:word` rendering word, meaning,
> and static IPA transcription. URL normalization. 404 with fuzzy-match
> suggestions and word-request capture. Responsive mobile layout. Seed dataset
> of ~100 common American English words.

Concretely, five pieces of work:

1. **The word page** — `GET /:variant/:word` as the B2 cacheable shell.
2. **URL normalisation** — canonical form, 301 redirects, rejection rules.
3. **The fuzzy 404** — suggestions via the E3 two-stage algorithm.
4. **Word-request capture** — the 404-page form, rate limited and Turnstile-gated.
5. **The seed** — ~100 en-us words with meanings and IPA, plus the ingestion
   pipeline that produces them.

---

## 5. Governing IDs — read these, and only these

Resolve through `DOC_INDEX.md` §3/§5 first. The minimum reading set:

### Requirements (SRS v1.0)

| ID | Covers |
|---|---|
| `FR-WORD-01` | URL pattern, variant routing, variant validated before word lookup |
| `FR-WORD-02` | Slug normalisation, allow-list, 301 to canonical, 400 on control characters |
| `FR-WORD-03` | Word page content, `is_primary` + `display_order`, syllable/stress, attribution — **partially satisfied this iteration; see §8.1** |
| `FR-WORD-04` | Fuzzy 404, up to five suggestions, genuine 404 status |
| `FR-WORD-05` | Word-request capture, rate limit, Turnstile, duplicate up-vote behaviour |
| `FR-WORD-07` | Responsive layout |
| `FR-WORD-08` | Graceful degradation without JavaScript |
| `FR-WORD-09` | Canonical tag and SEO basics (*Should*) |
| `FR-WORD-10` | Seeded dictionary coverage at launch |
| `FR-CONTENT-01` | Dictionary seed from open sources |
| `FR-CONTENT-05` | Upstream attribution on word pages |
| `FR-CONTENT-06` | Language-variant table |
| `NFR-PERF-04`, `NFR-PERF-05` | Cached TTFB budget; the 50 ms p95 shell composition budget |
| `NFR-PERF-07` | 150 KB gzipped asset budget |
| `NFR-LEGAL-05` | Upstream attribution requirement |
| Appendix C | Rate-limit reference for FR-WORD-05 |

### Design (SDD v1.1 + Round 1 Decisions)

| ID | Covers |
|---|---|
| `B2` | Cacheable shell + hydration split — the structural spine of this iteration |
| `E1` | Seed data ingestion pipeline |
| `E3` | 404 fuzzy match: two-stage, Optimal String Alignment blended with Double Metaphone, run in-app over the cached headword list. Plain Levenshtein and Soundex were **rejected** — do not substitute |
| `E4` | Word and pronunciation data model, `is_primary`/`display_order`, audio provenance columns |
| SDD §4.2 | Table definitions: `words`, `word_pronunciations`, `word_requests` (and `phonemes`, `phoneme_example_words`, `pronunciation_phonemes`, `audio_assets` — see §8) |
| SDD §5.3 | **Flow 3, word page render.** The authoritative sequence for this iteration |
| SDD §6.3 | Caching headers and Cloudflare purge on re-seed |
| SDD §3.4 | Shell/hydration composition and the structuring decision behind it |

Foundational Decisions §10.3 governs the FR-WORD-05 rate limit.

---

## 6. Schema work

New Flyway migrations, starting at `V3__`. From SDD §4.2:

- **`words`** — `UNIQUE (variant_id, normalized_headword)`, word-level meaning
- **`word_pronunciations`** — many per word, `is_primary` + `display_order`
  validated at ingestion so exactly one primary exists, optional heteronym gloss
- **`word_requests`** — FR-WORD-05, with the duplicate up-vote counter

Read each table's subsection in SDD §4.2 for the exact columns; do not infer
them from this handoff. Check §4.8 (indexing) and §4.9 (deletion relationships
and the erasure-privilege surface) before finalising.

**These are staged migrations.** Ship `word_pronunciations` without
`whole_word_audio_asset_id`, and `word_requests.submitted_by_user_id` nullable
without its FK. Do not create `audio_assets` or `users` to satisfy a future
foreign key. See §8.3, which governs.

---

## 7. New infrastructure this iteration introduces

Iteration 0 deliberately shipped none of this. Iteration 1 is where it lands,
and it is the bulk of the non-obvious work:

- **Redis-backed rate limiting** (FR-WORD-05, Foundational §10.3, NFR-SEC-11) —
  Redis in staging/production, in-memory in local development, selected by
  configuration. Redis and its client already exist; the middleware does not.
- **Cloudflare Turnstile** (FR-WORD-05) — new secret, must be added to
  `.env.example` and to the config schema. `.env.example` currently lists only
  what config validates.
- **The `validators/` layer** — currently empty. Slug normalisation and the
  word-request form are its first residents. Zod is already a dependency.
- **The seed/ingestion pipeline** (E1) — belongs in `scripts/`, reusing services
  per the C4 "one implementation, several entry points" rule.
- **Cloudflare cache purge on re-seed** (SDD §6.3) — build the adapter seam;
  production credentials and API execution are deferred, and the local stack must
  not fake a purge. See §8.5.

---

## 8. Settled scope boundaries — maintainer decisions, 2026-09-09

These were open questions when this handoff was drafted. The maintainer has
since settled all of them. **They are decisions, not questions.** Do not reopen
them, and do not stop to ask about them.

### 8.1 Iteration 1 renders static IPA text only

Iteration 1 stores and renders `word_pronunciations.ipa_transcription` as text.

**Do not create or implement any of the following in Iteration 1:**

- the `phonemes` table
- the `phoneme_example_words` table
- the `pronunciation_phonemes` junction table
- `data-phoneme-id` attributes
- clickable IPA elements
- the phoneme popover

All six belong to Iteration 2, exactly as the iteration plan says.

`FR-WORD-03` is therefore **intentionally partially satisfied** in Iteration 1
and completed in Iteration 2. This is normal for an iterative build: an FR does
not have to be fully satisfied by the first iteration that touches it. Note this
in the completion report rather than treating it as a gap.

### 8.2 Whole-word audio is entirely Iteration 2

Do not render a dead, disabled, or placeholder audio control in Iteration 1. A
control that cannot work is worse than temporarily leaving it out.

An Iteration 1 word page carries exactly: **word + meaning + static IPA +
syllable/stress + upstream attribution.** Iteration 2 adds the audio experience
and the FR-IPA-05 fallback chain.

### 8.3 Migrations may represent an intermediate schema state

The SDD §4 schema is the **destination**, not a requirement that every final
foreign key exist in the first migration that touches a table.

Do not create unrelated future tables solely to satisfy future foreign keys.
This preserves the Iteration 0 rule — *no table ships ahead of its code* — while
the final migrated schema still converges exactly to SDD §4.

Specifically:

- `word_pronunciations` ships **without** `whole_word_audio_asset_id` and its FK.
  Iteration 2 adds both when `audio_assets` lands.
- `word_requests.submitted_by_user_id` may exist **nullable and without its FK**
  while there is no `users` table. The later authentication iteration adds the FK.
- Do **not** create `audio_assets` or `users` in Iteration 1.

Document each of these in the migration file itself as a **deliberate staged
migration**, not as a change to the final schema.

### 8.4 English Wiktionary is the Iteration 1 seed source

Do not spend a design cycle selecting a dictionary. The design already revolves
around Wiktionary; use **English Wiktionary** as the primary Iteration 1 seed
source.

For every imported word, preserve at minimum:

- source entry URL
- source licence
- retrieval date

Wiktionary states that original entry text is dual-licensed under CC BY-SA 4.0
and GFDL. PronounceAll takes the **CC BY-SA 4.0 reuse path**, with attribution
and ShareAlike compliance (FR-CONTENT-05, NFR-LEGAL-05).

Wiktionary also warns that embedded media and externally sourced material may
carry separate terms — a further reason not to ingest audio this iteration. For
the ~100-word seed, **do not import quotations, usage examples, or unrelated
external material.** Meanings, pronunciation data, and attribution are enough.

### 8.5 Cloudflare cache purge — keep the seam, defer the credentials

Implement the content pipeline so cache invalidation has a clean adapter seam
per SDD §6.3 and the C4 ports-and-adapters rule. Actual production Cloudflare
purge credentials and API execution may wait until the production-edge and
deployment work.

**Do not fake Cloudflare locally.** A seam with no configured adapter is correct;
a stub that pretends to purge is not.

### 8.6 `size-limit` lands in Iteration 1

There is finally a real word page to measure. Add the job to
`.github/workflows/ci.yml` against the NFR-PERF-07 budget of 150 KB gzipped for
a word page's document, critical CSS, and core JavaScript.

### 8.7 Leave these alone

- **`bootstrap.js` mirror precedence is unchanged.** The localStorage mirror wins
  over a freshly-issued server cookie. FR-AUTH-02 is silent on precedence, and
  preferring the fresh cookie would orphan a returning visitor's saved words.
  Revisit only if Iteration 4's merge logic demands otherwise.
- **Do not change the project's AGPL licence choice during Iteration 1.**
  `-only` versus `-or-later` is a genuine owner decision, but it does not block
  this iteration and is not word-page work.

### 8.8 Out of scope by dependency

`FR-WORD-06` (progress-aware IPA banner) needs save/tag state, which arrives in
Iteration 3.

## 9. Running and verifying

```bash
docker compose up -d mysql redis
npm run migrate          # Flyway
npm run dev              # http://localhost:3000
```

`.env` exists locally and is git-ignored; `cp .env.example .env` on a fresh
clone. `docker compose down` when finished.

The gate, all of which must pass:

```bash
npm run lint             # architecture + SQL rules
npm run lint:licence     # NFR-LEGAL-03
npm test                 # unit + integration
npm run test:e2e         # Playwright, 4 projects
npm audit --audit-level=high --omit=dev
```

Test the invariants, not the happy path: slug normalisation edge cases
(null bytes, Unicode, apostrophes, mixed case), the genuine-404 status,
duplicate word-request up-voting, the rate-limit boundary and its `Retry-After`,
Turnstile rejection, and the no-JavaScript reading path.

---

## 10. Definition of done for Iteration 1

- [ ] `GET /en-us/<seeded word>` renders as the B2 cacheable shell, readable with
      JavaScript disabled, with meaning, **static IPA text**, syllable/stress, and
      upstream attribution — and **no audio control** (§8.1, §8.2)
- [ ] Slug normalisation: 301 to canonical, 400 on control characters, apostrophe
      and hyphen words resolve
- [ ] Unsupported variant returns 404, not the `en-us` page
- [ ] Fuzzy 404 returns a genuine 404 with up to five E3-ranked suggestions, and
      `cuppcake` surfaces `cupcake`
- [ ] Word-request form writes to `word_requests`, up-votes duplicates, returns
      429 with `Retry-After` past the limit, rejects a missing Turnstile token
- [ ] ~100 en-us words seeded from English Wiktionary through a repeatable
      `scripts/` pipeline, every word with exactly one `is_primary` pronunciation
      and each carrying source URL, licence, and retrieval date (§8.4)
- [ ] No `phonemes`, `phoneme_example_words`, `pronunciation_phonemes`,
      `audio_assets`, or `users` table was created (§8.1, §8.3)
- [ ] Responsive at mobile widths; zero axe-core violations
- [ ] Shell carries `public, s-maxage=…` and no `Set-Cookie`; verified
- [ ] Full gate green; `size-limit` job added (§8.6)
- [ ] Staged-migration decisions documented in the migration files themselves (§8.3)
- [ ] Completion report per root `CLAUDE.md` §11

---

## 11. Rules of engagement for the next chat

1. Start at `DOC_INDEX.md`. Never read an SRS/SDD end to end.
2. State the governing requirement and decision IDs before substantial coding.
3. If two authoritative sources conflict and the SDD §6 amendment ledger does not
   explain it — **stop and report**. Do not pick a side. This is the *only*
   reason to stop; §8 is settled and must not be re-asked.
4. Keep diffs narrow. No unrelated refactoring, renaming, or reformatting.
5. Do not modify anything in `docs/current/` during an implementation task.
6. Run `git status` before and after. Never commit, push, or reset unless asked.
7. If a check cannot run locally, report the exact command and blocker rather
   than silently skipping it.
