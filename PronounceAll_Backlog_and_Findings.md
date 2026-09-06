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
**Affects:** `Deprecated Documents/PronounceAll_SRS(R2).md`, FR-IPA-08 acceptance criteria

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

*End of register.*
