# PronounceAll — Backlog and Findings Register

**Purpose:** A single durable home for two kinds of item that surface during documentation work but must not be acted on immediately: future feature ideas, and defects found while reading existing documents. Recording them here prevents loss between chats and prevents mid-pass scope creep.

**Owner:** Alp K.
**Status:** Living document. Append freely; do not delete resolved items, mark them instead.

---

## How to use this document

Two sections, two different meanings.

**Section 1, Post-v1.0 ideas.** Features and improvements deliberately kept out of v1.0. Nothing here is committed. Items graduate into the Charter and the SRS only through an explicit scope decision, never by drifting in during a reading pass.

**Section 2, Findings from reading passes.** Defects, contradictions, and wording problems found in documents that are already drafted. These are real problems awaiting a fix, not optional ideas. Each is fixed either in the Round 4 merge or in a dedicated correction pass.

**When adding an item,** record the date, a one-line summary, and enough reasoning that the item makes sense months later. Where an item touches specific documents, name them, since that determines the size of the eventual change.

**Status values:** Open, Deferred, Scheduled, Applied, Rejected.

---

## Section 1 — Post-v1.0 ideas

### IDEA-01 — Search for words by IPA symbols

**Recorded:** 15 August 2026
**Status:** Open, post-v1.0 candidate

**The idea.** Allow a user to search for words using IPA symbols rather than ordinary spelling. Two possible forms: search restricted to one language variant, and search across every seeded variant at once.

**Why it is attractive.** It inverts the core product flow. Today a learner arrives with a word and discovers its sounds. This would let a learner arrive with a sound, or a sequence of sounds, and discover which words contain it. That suits the stated goal of teaching IPA as a transferable mental model rather than as a per-word lookup.

**Why it is not in v1.0.** Two blockers, of different weight.

First, it requires a word search algorithm operating over phoneme subsets. That same machinery is the stated reason IPA-subset practice was already deferred, recorded at R2 line 607 and in Charter §6. Building it for search but not for practice would be inconsistent, so the two should probably be scoped together.

Second, the cross-language form presumes several seeded variants. Version 1.0 ships American English only, so an all-variants search cannot meaningfully exist until a second variant is added, regardless of what is decided about the single-variant form.

**If it were promoted into scope,** the change would touch Charter §5, Charter §6, and §4.2 of the Round 2 SRS together, and would need its own functional requirements. That is a formal scope change, not a small edit.

---

## Section 2 — Findings from reading passes

### FIND-01 — FR-IPA-08 acceptance criterion is impossible for some phonemes

**Recorded:** 15 August 2026
**Source:** Reading pass on Round 2 SRS, §4.2
**Status:** Scheduled (SDD Round 1 Decisions §6 item 6; scheduled for the Iteration 2 seed validation test per §7)
**Affects:** `docs/archive/PronounceAll_SRS(R2).md`, FR-IPA-08 acceptance criteria

**The problem.** The second acceptance criterion states that a linter or seed validation test rejects phoneme rows where the first phoneme of the displayed example word differs from the target phoneme. That rule requires every example word to begin with the sound it illustrates.

Several English phonemes cannot satisfy this. The sound written `/ŋ/` never begins an English word, so `sing`, which is the conventional example, would be rejected. The sound written `/ʒ/` has the same difficulty, since the usual examples are `measure` and `vision`. Applied literally, the check would reject correct seed data and leave those phonemes without a valid example word.

**Why it matters.** The body of the requirement is sound. The intent, meaning that an example must demonstrate the target sound rather than a matching letter, is correct and worth keeping. Only the test as written is wrong, because it substitutes word initial position for the broader property actually wanted, which is that the example word genuinely contains the target phoneme.

**Direction for the fix, not yet drafted.** The check should assert that the target phoneme appears somewhere in the phonemic transcription of the example word, rather than at its start. A stricter variant could prefer word initial position where the phoneme permits it, while allowing any position otherwise.

**Suggested handling.** Fold into the Round 4 merge, or into a correction pass before it. Not urgent, since no code depends on it yet, but it must be fixed before the seed validation test is implemented in Iteration 2.

---

### FIND-02 — NFR-PRIV-06 personal-data inventory omitted the off-site backup destination

**Recorded:** 3 September 2026
**Source:** Reading pass during SDD Round 2, Section 2 boundary modeling
**Status:** Resolved (amendment applied to NFR-PRIV-06)
**Affects:** `PronounceAll_SRS_v1_0.md`, NFR-PRIV-06 (downstream: Privacy Policy, Threat Model)

**The problem.** NFR-PRIV-06 enumerated Google OAuth, Cloudflare, HIBP, and the transactional email provider and closed with "No other data leaves the origin," but NFR-OPS-01 requires a nightly logical database backup pushed off-site, and frozen SDD decision V6 makes that destination Backblaze B2. An encrypted logical backup contains the personal data stored in MySQL, so a fifth personal-data destination existed that the requirement neither listed nor allowed. The Round 1 §6 ledger did not reconcile it.

**Resolution.** NFR-PRIV-06 was amended to add the off-site backup provider (Backblaze B2) as a personal-data destination and to state that no other intentional personal-data flow leaves the origin.

**Carried forward to the Threat Model.** Determine whether the error-tracking service (Sentry or equivalent, NFR-OPS-03) transmits residual metadata that qualifies as personal data. If it does, add that service to NFR-PRIV-06, the Privacy Policy, and the Threat Model before production use. This is a Threat Model task, not a further Section 2 change.

---

### FIND-03 — B2 cacheable word shell versus FR-AUTH-01 cookie issuance

**Recorded:** 5 September 2026
**Source:** Reading pass during SDD Round 2, Section 3 architecture review
**Status:** Resolved (amendment applied to FR-AUTH-01)
**Affects:** `PronounceAll_SRS_v1_0.md`, FR-AUTH-01 (and SDD §3.4)

**The problem.** SDD decision B2 serves the word page shell as a shared, long-lived edge-cached response, but FR-AUTH-01 required the `pa_uid` cookie to be set on any request lacking it and refreshed on every subsequent request. A Cloudflare cache hit never reaches the origin, and a shared cached `Set-Cookie` would assign every viewer the same UUID, so the two could not both hold. The Round 1 ledger did not reconcile it. FR-AUTH-02 and FR-AUTH-03 were verified consistent and needed no change.

**Resolution.** FR-AUTH-01 was amended to issue `pa_uid` and refresh its sliding `Max-Age` on uncached origin-reaching responses (the viewer bootstrap or hydration request, or the first write or other non cached request), never on the cached shell. This preserves frozen B2 with no edge-personalisation machinery.

---

### FIND-04 — B2 cacheable word shell versus NFR-SEC-03 per-request CSP nonce

**Recorded:** 5 September 2026
**Source:** Reading pass during SDD Round 2, Section 6 caching inputs
**Status:** Resolved (amendment applied to NFR-SEC-03)
**Affects:** `PronounceAll_SRS_v1_0.md`, NFR-SEC-03 (and SDD §3.4, §6.3)

**The problem.** NFR-SEC-03 requires every HTML response to carry a CSP header including `script-src 'self' 'nonce-<per-request>'` and `style-src 'self' 'nonce-<per-request>'`, and its acceptance criterion names `/en-us/cupcake` among the pages that must carry every listed directive. SDD decision B2 serves the word page shell as a shared, long-lived edge-cached response identical for every viewer. A per-request nonce baked into a shared cached response is the same value for every viewer for the cache lifetime, which does not satisfy the intended per-response nonce property and weakens nonce-based injection protection, so the two requirements cannot both hold on the cached shell. The Round 1 §6 ledger did not reconcile it.

**Resolution.** NFR-SEC-03 amended to scope the per-request nonce to uncached, origin generated HTML responses, and to require the cacheable word page shell to contain no inline `<script>` or `<style>` and to carry a nonce free equivalent policy (`script-src 'self'`, `style-src 'self'`), preserving the no `unsafe-inline` and no `unsafe-eval` guarantee without a shared static nonce. This preserves frozen B2 with no edge nonce injection machinery.

---

### FIND-06 — password_hash table placement: V3 versus SRS Appendix E

**Recorded:** 5 September 2026
**Source:** SDD Round 2, Section 4 schema derivation
**Status:** Resolved (V3 mechanism sentence clarified; schema follows Appendix E)
**Affects:** `PronounceAll_SDD_Round1_Decisionsv1_0_3.md` V3 (SRS FR-AUTH-08 and Appendix E unchanged)

**The problem.** V3's mechanism sketch placed `password_hash` on the `users` row beside `session_epoch`, while the SRS normative PII inventory (Appendix E, NFR-PRIV-01) and FR-AUTH-08's row test place `password_hash` on `user_accounts`. A column lives in one table, so the two could not both hold.

**Resolution.** The schema keeps `password_hash` on `user_accounts` (per Appendix E, which is normative for field placement, and consistent with the one row per authentication method model implied by FR-AUTH-04) and `session_epoch` on `users` (per V3's decision). V3's mechanism sentence was clarified so a password change updates `user_accounts.password_hash` and `users.session_epoch` in the same MySQL transaction, which preserves V3's atomicity guarantee unchanged. The V3 architectural decision is not reopened.

---

### FIND-09 — Appendix C `GET` word-page rate limit cannot be enforced at the origin under B2

**Recorded:** 10 September 2026
**Source:** Iteration 1 implementation (word pages)
**Status:** Deferred — to the Cloudflare/WAF deployment work
**Affects:** SRS Appendix C, Foundational Decisions §10.3, decision B2, SDD v1.1 §6.3

**The problem.** Appendix C and Foundational Decisions §10.3 both list `GET` word pages at 120 per minute keyed by the `pa_uid` cookie UUID, as a scraping defence. Iteration 1 implements every other Appendix C limit it owns, but not this one, because enforcing it in Express contradicts B2 on two counts.

First, the word-page shell is a SHARED, edge-cached response. Reading `pa_uid` to key a counter makes the response depend on per-viewer identity, which is precisely what B2 and the amended FR-AUTH-01 forbid on that response class — the shell carries no `Set-Cookie` and must be identical for every viewer.

Second, the limit would not work where it matters. A cached shell is served by Cloudflare and never reaches the origin, so an origin-side counter sees only cache misses. A scraper walking the dictionary would be counted only on the words it happened to miss on, while the enforcement cost would fall on exactly the response B2 exists to make cheap.

**Resolution.** Deferred, not dropped. The limit belongs at the edge, alongside the Appendix C row that is already Cloudflare's (`All endpoints (edge)`, 1000/min per IP, NFR-SEC-02). Cloudflare sees every request, cached or not, which is the only vantage point from which a scraping limit on a cached resource is meaningful.

Implement it as a Cloudflare rate-limiting rule during the deployment/production-edge work. Do NOT implement origin-side UUID limiting for cached word-page `GET`s in the meantime. When it lands, note whether the identity key stays the `pa_uid` cookie or becomes IP at the edge, since the edge cannot depend on a cookie the cached response never sets.

**Iteration 1 status:** every other Appendix C limit this iteration owns is enforced — `POST /request-word` at 10/hour per UUID, Redis-backed in staging and production per NFR-SEC-11, returning 429 with `Retry-After`.

---

### FIND-10 — Word search exists in the product but not in the specification

**Recorded:** 2026-09-11
**Source:** Maintainer review of the running Iteration 2 build
**Status:** Implemented ahead of specification — **SRS addendum owed**
**Affects:** SRS Appendix F (endpoint catalogue), SRS §4.1 (`FR-WORD-*`), Appendix C (rate limits), the API Specification

**The problem.** There is no way to look a word up from inside the site. The SRS
specifies navigation as `GET /:variant/:word` only: Appendix F lists no search
endpoint, and no `FR-WORD-*` requires one. The implied model is that a reader
types the URL or arrives from a search engine, which is why `FR-WORD-09` and the
sitemap requirements exist.

That model has a hole. The E3 fuzzy matcher built for `FR-WORD-04` is already a
capable word-finder — `cuppcake` resolves to `cupcake` — but the only way to
reach it is to type a URL that fails. A reader who does not already know the
exact spelling has no route into the dictionary at all. For a reference product
that is a genuine usability gap rather than a deferred nicety.

Note that `search` is already a reserved name in Appendix A, so the route name
was protected without a feature ever being attached to it.

**What was done.** On the maintainer's instruction (2026-09-11) a word search was
implemented ahead of the specification, reusing the existing E3 ranking and the
cached headword list rather than introducing a second matcher:

- `GET /search?q=…&variant=…` — an exact match redirects to the word page; a
  near match renders the E3-ranked suggestions; no match offers the word-request
  form.
- A search form on the home page and on the search results page. It is a plain
  `GET` form, so it works with JavaScript disabled.

**Documentation owed.** This entry exists so the debt is not lost. The SRS should
gain:

1. a functional requirement in §4.1 — provisionally `FR-WORD-11` — covering the
   search input, the exact-match redirect, the ranked results, and the
   no-results path, with acceptance criteria;
2. an Appendix F row for `GET /search`;
3. a decision on whether Appendix C should rate-limit it. It is currently
   **unlimited**: the handler is an in-memory scan over the cached headword list
   for the variant, which is bounded by the `FR-WORD-10` launch target of ~5 000
   headwords and performs no database query per keystroke. That is defensible,
   but it is a policy choice the SRS should state rather than leave implicit;
4. a note in the API Specification, which is authoritative for endpoints.

**Design points worth recording before the requirement is written.**

- The route is top-level `GET /search` with the variant as a query parameter,
  NOT `/:variant/search`. The latter collides with `GET /:variant/:word` and
  would work only while the search route stays registered first — a silent
  break waiting for someone to reorder the routers. If the eventual requirement
  prefers the variant-first shape, the collision must be handled explicitly
  rather than by registration order.
- Search results are served uncached (`private, no-store`). They are not
  per-viewer, so they could in principle be edge-cached, but a query string
  makes a cache key per query for little benefit; B2's cacheable-shell class
  remains reserved for word pages.
- Input is normalised leniently rather than validated strictly. The slug
  validator of `FR-WORD-02` answers 400 on a character outside the allow-list,
  which is right for a URL and wrong for a free-text box: a reader who types
  `Cup Cake!` should get results, not an error.

---

### FIND-11 — Dictionary expanded to ~6 150 words; two consequences to record

**Recorded:** 2026-09-11
**Source:** Maintainer instruction after finding ordinary words missing from the running build
**Status:** Expansion applied; two follow-ups noted below
**Affects:** SRS `FR-WORD-04` acceptance criteria, SRS `FR-WORD-10`

**What happened.** The Iteration 1 seed held 123 words. It was composed to
EXERCISE the pipeline — heteronyms, apostrophes, hyphens, awkward stress — and
never to cover ordinary vocabulary, so it was missing `happy`, `good`, `house`,
`car`, `think`, `go` and about thirty other words a person types first. The
maintainer hit exactly that and reasonably read it as a broken dictionary.

The seed was expanded to **6 150 headwords** through the existing pipeline, with
headword SELECTION driven by Wiktionary's own frequency ranking (ranks 1–10 000)
and meaning, IPA, and attribution still coming from the approved entry path. No
second ingestion system was introduced. `FR-WORD-10`'s ≥5 000 floor is now met
with about 23 % margin.

**Consequence 1 — `FR-WORD-04`'s `xqzzy` example has gone stale.**

The acceptance criterion reads: *`GET /en-us/xqzzy` returns HTTP 404, shows no
suggestions (no sufficiently close match)*. Against 6 150 words `xqzzy` IS close
enough to `sexy` to be offered, so the literal example now fails while the
matcher is working correctly — the criterion silently assumed a small
dictionary.

The tests now use `qxzjvwkmpf`, which stays unmatchable as the corpus grows. The
criterion's INTENT is unchanged and still enforced. The SRS should be amended to
either use a slug that cannot drift, or to state the property rather than a
particular string. Nothing was changed in E3: the ranking threshold is doing its
job and tuning it to preserve an example would be the tail wagging the dog.

**Consequence 2 — a coverage tripwire now exists.**

`SMOKE_VOCABULARY` in `scripts/seed-headwords.js` lists ~48 ordinary words, and
`tests/integration/seed-coverage.test.js` asserts every one resolves after a
seed. This is deliberately not a size check: the 123-word seed would have passed
any reasonable size assertion at its own scale while being useless in practice.
It is a list of words a learner types first, and it fails loudly if the seed
stops containing them.

**Also worth knowing.** Roughly 1 850 of the 8 000 requested headwords do not
load, dominated by two causes that are both correct behaviour rather than
defects: about 1 066 have no identifiable American transcription, and about 919
are inflected "form-of" entries (`went`, `said`) whose Wiktionary page carries no
independent definition. Only ~35 are lost to D4 canonical validation. These are
reported by the seed, not hidden.

---

*End of register.*
