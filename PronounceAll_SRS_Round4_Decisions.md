# PronounceAll — SRS Round 4 Decisions

**Purpose:** This document captures every decision made during the SRS Round 4 question batch (16 items left open at the end of Rounds 2 and 3) so the merged SRS v1.0 can be drafted in a fresh chat without re-asking, and so subsequent design documents (SDD, ERD, etc.) can reference the rationale behind each choice. Paste this alongside the Charter, Project Handoff Document, Foundational Decisions, Round 2 SRS, and Round 3 SRS when starting the Round 4 drafting chat or any later document chat.

**Status:** Round 4 decisions complete. Round 4 drafting (the merge + apply + sweep + ToC pass) is the next step.

**Companion document:** `PronounceAll_SRS_Foundational_Decisions.md` covers Round 1 decisions (security posture, audience, performance floor, browser support, anonymous identity, registration, deletion, bot protection, rate limiting). This file covers everything decided after Rounds 2 and 3 had drafts in hand.

---

## 1. How to use this document

When opening the Round 4 drafting chat:

1. Upload Charter, Handoff Document, Foundational Decisions, Round 2 SRS (`PronounceAll_SRS.md`), Round 3 SRS (`PronounceAll_SRS_Round3.md`), the Round 4 Handoff (`SRS_Round4_Handoff.md`), and **this file**.
2. Instruct: "Produce SRS v1.0 (Round 4) per §2 of the Round 4 Handoff. Apply the maintainer answers from the Round 4 Decisions Document."
3. Round 4 is **mechanical**: merge Round 3 into Round 2, apply the 16 decisions below at the points where they're flagged, sweep cross-references, polish wording, produce a full ToC. No new requirements. No revisiting Foundational Decisions.

---

## 2. Round 2 — Functional Requirements

### FR-PRACTICE-04 — SM-2 quality mapping for self-assessment

**Decision:** Right → quality **5**, Wrong → quality **2**.

**Rationale:** A quality of 5 is SM-2's "perfect recall, easy" rating; this lets correctly-recalled words drift to longer intervals more aggressively, reducing repetition of words the user clearly knows. Quality 2 on wrong answers is moderate — it forces a meaningful interval reset without being so harsh that a single slip nukes weeks of progress (which a quality of 0 or 1 would cause). This is the more forgiving end of the practical mapping range; it suits a self-assessment app where the cost of "asking too rarely" is small (the user can re-save the word) but the cost of "asking too often" is real fatigue.

**Implementation note for SDD:** SM-2's standard formula treats quality < 3 as a failure (interval resets to 1 day, repetitions reset to 0) and quality ≥ 3 as success (ease factor adjusted, interval grown). Our mapping (5/2) puts wrong answers firmly in the failure branch and right answers at the top of the success branch.

---

### FR-PRACTICE-06 — Practice session idle timeout

**Decision:** **60 minutes**.

**Rationale:** Practice is a self-paced activity where users may pause to look something up, take a phone call, or step away briefly. A short timeout (15 or 30 min) frees session rows sooner but punishes legitimate pauses by forcing users to restart their session, losing their place in the queue. Sixty minutes is forgiving for human behavior while still bounded enough that abandoned sessions don't accumulate indefinitely. This intentionally diverges from the auth session idle timeout (30 min from Foundational Decisions §2) — practice idle timeout is a UX concern, not a security concern, so it doesn't need to match.

---

### FR-WORD-10 — Seed dictionary size at v1.0 launch

**Decision:** **≥ 5,000 American-English headwords** (default), with an explicit architectural note that the variant infrastructure must scale to ~50 languages and the full headword count of each.

**Rationale:** 5,000 headwords is the minimum to make the app genuinely useful at launch — it covers the most common American English words a learner would look up. The 50-language scaling note is not a v1.0 functional requirement; it is a constraint on how Iteration 0–1 must structure the schema, URL routing, and content pipelines. The `:variant/:word` URL pattern (already locked) and the `language_variants` table planned in the Handoff already accommodate this. Round 4 should add a one-line architectural note in FR-WORD-10's rationale capturing this intent without inventing a new requirement.

**Implementation note for SDD:** seed-data ingestion pipelines, audio fallback chain, and TTS pre-generation should all be designed so that adding a new variant is a row insert + a content batch run, not a code change.

---

### FR-AUTH-05 / Appendix A — Reserved-username list

**Decision:** Extend the default inline list (`admin`, `root`, `api`, `settings`, common route/brand-squat strings) with **(A) admin synonyms** and **(B) a profanity blocklist**.

**Detail:**
- **Admin synonyms** to add: `administrator`, `sysadmin`, `mod`, `moderator`, `support`, `help`, `staff`, `team`, `official`, `owner`, `system`, `webmaster`, `postmaster`. (Final list to be settled during Iteration 0 implementation; this is a starting set.)
- **Profanity blocklist:** referenced via an externally maintained list rather than enumerated in the project repository. Recommended source: the LDNOOBW list (`fka/cuss` package on npm) or equivalent, loaded at startup from a config file. The SRS states the requirement abstractly; the SDD picks the specific package.

**Rationale:** Enumerating slurs and sexual terms inline in the SRS or in the project repo creates a maintenance and reputational liability. Referencing an external maintained list keeps the project doc clean while still satisfying the requirement. The reserved list is loaded at startup; updating it is a deploy, not a database migration.

**Note:** No personal handles added. The maintainer chose not to reserve their own username.

---

### FR-SAVE-08 — Save idempotency window

**Decision:** **30 seconds** (default).

**Rationale:** Covers the realistic range of mobile network retries (browser/client TCP retransmissions, hung-then-resent requests on flaky connections) without holding idempotency keys in the dedup store longer than necessary. Stripe-style multi-hour windows are unnecessary because the harm of a duplicate save event in this system is small — derived state is "latest event wins per target," so duplicates only add noise to the event log, not bad UX or financial loss. Five seconds would be too tight for real-world mobile retries; five minutes would balloon the dedup store with no meaningful benefit.

---

### FR-SAVE-09 — `audio_listen` event capture priority

**Decision:** **Must** (priority elevated from default Should).

**Rationale:** Capturing audio-playback events from v1.0 onward is a strategic requirement, not a nice-to-have. Without this data, post-v1.0 features like "your weakest phonemes are…" analytics cannot be retroactively built — there will be no historical data to analyze. Treating it as Must forces test coverage and forces the event-log schema to accommodate audio events from the start, which is cheaper than retrofitting later.

**Implementation note for SDD:** event types in the `user_activity_events` table must include `audio_listen_word` and `audio_listen_phoneme` (or equivalent), with payloads sufficient to drive the future analytics features (target ID, source page, success/failure, timestamp).

---

### FR-AUTH-18 — Merge tie-breaker on identical timestamps

**Decision:** **Millisecond-precision timestamps; latest event wins** (no special tie-breaker between anonymous and registered).

**Rationale:** Upgrading event timestamps to millisecond precision makes same-timestamp collisions effectively impossible at this system's volume, eliminating the need for a tie-breaker rule. The "latest wins" rule already covers all real cases. This is simpler, more honest, and removes a class of edge-case bug from the merge logic.

**Implementation note for SDD:** the `user_activity_events` table's timestamp column should be `DATETIME(3)` or `TIMESTAMP(3)` (MySQL millisecond precision) or use a `BIGINT` Unix-millis column. This decision was made implicitly in Round 1 ("collect timestamps of all of it") and is now explicit. If true sub-millisecond collisions ever occur at scale, they can be tie-broken by event ID (auto-increment) within the same millisecond, but this is a design-time fallback, not a stated SRS requirement.

---

## 3. Round 3 — Non-Functional Requirements

### NFR-PRIV-02 — Anonymous profile dormancy retention

**Decision:** **2 years of inactivity** (default), then purged. Revisit if storage or memory pressure becomes a concern.

**Rationale:** Matches the cookie's `Max-Age` sliding-renewal window (Foundational Decisions §6). A user whose cookie has been forgotten by their browser cannot rejoin their old anonymous profile anyway, so retaining the data longer than 2 years has no privacy benefit and no UX benefit. Anonymous profiles are not high-value data — losing them after 2 years of dormancy is acceptable. The "revisit if pressure appears" note acknowledges that this can be tuned downward without harm if the dormant tail of the profile table grows large.

**Implementation note for Runbook:** scheduled job runs nightly (or weekly), deletes anonymous profiles where `last_activity_at < NOW() - INTERVAL 2 YEAR` and cascades to associated events and derived state.

---

### NFR-OPS-01 — Backup retention schedule

**Decision:** **Daily × 30 + weekly × 26** (default). Stated RPO: up to 24 hours.

**Rationale:** Off-site storage for a database of this size (~10–100 MB at launch) costs cents per month, so the cheaper "weekly × 13" alternative offers no meaningful savings. The default schedule covers both fast-recovery scenarios (yesterday's catastrophe → restore last night's backup, lose ≤ 24 h) and slow-corruption scenarios (bug discovered weeks later → restore a week before the bug). Stating RPO as "up to 24 hours" is honest and matches the daily-backup interval; tighter RPO would require continuous binlog streaming, which is out of scope for v1.0.

**Implementation note for Runbook:** automated nightly `mysqldump` to off-site object storage (Hetzner Storage Box, Backblaze B2, or equivalent — chosen in SDD). Weekly snapshots are a separate retention bucket, not separate backups (i.e., the same daily backup is just kept longer if it falls on a weekly retention boundary).

---

### NFR-OPS-04 — Application log retention

**Decision:** **90 days at launch**, with a post-launch milestone to reduce to **30 days** once incident frequency stabilizes.

**Rationale:** The first weeks/months after launch are when most operational issues surface — slow queries, edge-case bugs, error patterns. Ninety days of log history makes incident investigation feasible during that period (a bug reported "last month" still has logs to inspect). Once the system is stable and incident frequency drops, 30 days is sufficient and reduces storage cost and GDPR storage-limitation exposure.

**Phrasing for SRS:** the requirement should state both numbers and the milestone: "v1.0 retains application logs for 90 days. Post-launch milestone: when the maintainer judges incident frequency has stabilized, reduce retention to 30 days." This makes the intent explicit without hardcoding a calendar date.

---

### NFR-SEC-02 — HSTS deployment

**Decision:** **Stability-milestone-tied 4-step ramp**, not calendar-based.

| Phase | Trigger to advance | `max-age` value | Other directives |
|---|---|---|---|
| Launch (post-Iteration 7 deploy) | — | **300** (5 min) | none |
| Initial stability confirmed | No HTTPS/TLS incidents observed during the prior phase | **86,400** (1 day) | none |
| Sustained stability | Continued absence of TLS / Cloudflare / cert incidents | **2,592,000** (30 days) | none |
| Mature posture | Maintainer judgment that TLS configuration is settled and unlikely to change | **15,552,000** (180 days) | `includeSubDomains; preload` + submission to the HSTS preload list |

Each advance is a maintainer decision, **not** a calendar trigger. This is consistent with the project's iteration-and-milestone cadence rather than a time-based one. The ramp is monotonically non-decreasing, as required by the HSTS spec — `max-age` may only increase or be reset to 0 (never decreased to a non-zero value, since browsers cache the higher value).

**ASVS v5.0.0 conformance note.** Requirement v5.0.0-3.4.1 (L1, inherited by L2) requires `Strict-Transport-Security` with a minimum `max-age` of 1 year and, at L2, `includeSubDomains`. Phases 1–3 of this ramp (5 min, 1 day, 30 days, all without `includeSubDomains`) are deliberately below that floor as a defensive choice during initial deployment, when TLS / Cloudflare / Certbot misconfigurations are most likely and recoverability matters more than long-term posture. Full conformance with v5.0.0-3.4.1 is reached at phase 4 (180 days + `includeSubDomains` + preload). The temporary non-conformance during phases 1–3 is to be recorded in the ASVS L2 control-mapping document required by NFR-SEC-01 as an explicit, time-bounded deferred control with the milestone trigger from the table above as the resolution criterion.

**Rationale:** A solo-dev launch will produce TLS / Cloudflare / Certbot configuration mistakes in the first weeks of production. A 5-minute `max-age` at launch means recovery from any such mistake is near-instant — browsers forget the rule before the maintainer has finished writing the post-mortem. Stepping up only after each phase has demonstrated stability gives the same final security posture as launching at 6 months + preload, but without the painful rollback path. Preload-list submission is intentionally last because de-listing takes weeks and ships only with browser updates.

**Implementation note for Runbook:** the HSTS header is set in Nginx (or Express middleware). Each phase advance is one config change + a deploy. The Runbook should include a checklist for what "stable" means at each milestone (no cert renewal failures, no Cloudflare TLS-mode incidents, no origin TLS errors in logs).

---

### NFR-PERF-04 — TTFB p95 budget at origin

**Decision:** **200 ms cached / 400 ms uncached, p95 at origin** (default). Revisit after Iteration 7 load-test baselines.

**Rationale:** Generous enough to be achievable on a single small Hetzner VPS running Node + Express + MySQL with sensible indexing, while tight enough to flag real regressions before they compound. A regression typically adds 100–500 ms (a missing index, a synchronous external API call, an N+1 query). The 400 ms uncached ceiling catches those. "At origin" means measured at the VPS, not at the user — Cloudflare edge latency is a separate concern handled by NFR-PERF-01 (CWV "Good") at the user-perceived level.

**Phrasing note for SRS:** "tight enough to flag real regressions" should be paraphrased into the requirement's rationale as "set to catch performance regressions of ~100 ms+ before they accumulate, while leaving headroom for legitimate variation."

---

### NFR-PERF-05 — Database query budget

**Decision:** **50 ms p95** for the sum of all database queries composing a word page (default).

**Rationale:** A composed word page does ~5–8 indexed queries (word, transcription, phonemes, user state, audio metadata). At 50 ms p95 across the sum, each query averages ~6 ms — easily achievable on MySQL 8 with sensible indexes on the schema planned in the ERD. This budget is isolated from TTFB to make it diagnosable: if TTFB drifts up but DB stays under 50 ms, the bottleneck is template rendering or middleware; if DB is over budget, the bottleneck is the database. Will be revisited if the seed dataset grows 10× or schema changes materially.

---

### NFR-PERF-07 — Page weight budget

**Decision:** **150 KB compressed for word pages, 200 KB compressed for both `/learnIPA` and `/:variant/learnIPA`**, excluding audio assets and web fonts (default).

**Rationale:** Disciplined target for a server-rendered EJS app with raw CSS. The exclusion of audio is deliberate — phoneme audio files are pre-loaded on word pages and lazy-loaded on both `/learnIPA` and `/:variant/learnIPA` (Foundational Decisions §4) and have their own weight characteristics tracked separately. Web fonts are excluded because they are cache-friendly across pages and shouldn't dominate the per-page measurement.

---

### NFR-PERF-08 — Pre-launch load test profile

**Decision:** **200 concurrent anonymous browsers + 20 concurrent practice sessions, sustained 10 minutes** (Alt A).

**Rationale:** The default profile (50 + 5) is too modest given that AGPL-licensed open-source projects can attract sudden Hacker News / Reddit / dev-community traffic spikes at launch. 200 + 20 is a more realistic rough-launch profile and gives the system a meaningful safety margin. Tooling choice (k6 or equivalent) is deferred to the Test Plan.

**Implementation note for Test Plan:** the load test must measure not only TTFB and error rate but also database connection saturation, Express event-loop blocking, and Cloudflare cache-hit ratio.

---

### NFR-OPS-06 — Availability commitment

**Decision:** **Best-effort, no SLA**. Internal aspiration: **99% monthly**, stated as a goal not a commitment.

**Rationale:** Honest framing for a free, solo-maintained, AGPL project. Hitting 99.9% requires monitoring + paging + on-call response, none of which is appropriate for an unpaid solo maintainer. Stating "best-effort with a 99% goal" sets honest expectations: users know the project tries to be reliable but won't promise something it can't deliver. The maintainer's note — "issues will come from dependencies anyway; if they can't provide better, neither can we" — is correct: any availability target above the floor of (Hetzner uptime × Cloudflare uptime × Let's Encrypt renewal reliability) is fictional.

**Phrasing for SRS and privacy policy:** "PronounceAll is provided on a best-effort basis. The project aspires to 99% monthly availability but does not offer a service-level agreement. Outages may occur due to upstream dependencies (hosting, CDN, certificate authority) or maintainer availability."

---

## 4. Cross-cutting notes for Round 4 drafting

When applying these decisions during the Round 4 merge:

- Decisions 1–7 are inline edits to existing FRs in §4 of the Round 2 SRS. No new FRs are created.
- Decision 4 (reserved-username list) updates **both** FR-AUTH-05 and Appendix A. The Appendix gets the admin-synonyms list inline and a reference to "an externally maintained profanity blocklist (specific package selected in SDD)" — it does **not** enumerate the profanity list.
- Decisions 8–16 are inline edits to existing NFRs in §5 of the Round 3 SRS. No new NFRs are created.
- Decision 11 (HSTS) replaces the current single-value default with the 4-phase table above. The traceability matrix in §6 of the Round 3 SRS may need a small note that NFR-SEC-02 is phased.
- Decision 6 (`audio_listen` priority) changes the requirement's MoSCoW level from Should to Must. This may shift the traceability matrix slightly; sweep §6 for any consequence.
- Decisions 3, 8, 10 each include a "revisit later" or "post-launch milestone" clause. The SRS should include each of these as part of the requirement's rationale, not as a separate requirement, and not as a TODO. The phrasing should be declarative ("v1.0 ships with X; subsequent revisions may reduce/increase based on Y") not promissory.
- The post-launch milestones in decisions 10 and 11 are decisions that the maintainer (not the SRS) makes during operations. The Runbook will track when each milestone is reached. The SRS only needs to state the launch value and the criterion for advancing.

---

## 5. Quick decisions summary (for cross-referencing during drafting)

| # | Item | Decision |
|---|---|---|
| 1 | FR-PRACTICE-04 SM-2 mapping | Right=5 / Wrong=2 |
| 2 | FR-PRACTICE-06 idle timeout | 60 min |
| 3 | FR-WORD-10 seed size | ≥ 5,000; arch must scale to ~50 languages |
| 4 | FR-AUTH-05 reserved usernames | Default + admin synonyms + external profanity list |
| 5 | FR-SAVE-08 idempotency window | 30 s |
| 6 | FR-SAVE-09 `audio_listen` priority | Must |
| 7 | FR-AUTH-18 merge tie-breaker | ms-precision timestamps; latest wins |
| 8 | NFR-PRIV-02 anon profile retention | 2 years inactivity |
| 9 | NFR-OPS-01 backup retention | Daily × 30 + weekly × 26; RPO ≤ 24h |
| 10 | NFR-OPS-04 log retention | 90 days at launch → 30 days when stable |
| 11 | NFR-SEC-02 HSTS | 4-step ramp tied to stability milestones |
| 12 | NFR-PERF-04 TTFB p95 origin | 200 ms cached / 400 ms uncached |
| 13 | NFR-PERF-05 DB query budget | 50 ms p95 |
| 14 | NFR-PERF-07 page weight | 150 KB / 200 KB ex. audio + fonts |
| 15 | NFR-PERF-08 load test | 200 anon + 20 practicing × 10 min |
| 16 | NFR-OPS-06 availability | Best-effort, 99% aspiration, no SLA |

---

*End of Round 4 decisions. Next chat: paste Charter + Handoff + Foundational Decisions + Round 2 SRS + Round 3 SRS + Round 4 Handoff + this file. Then instruct: "Produce SRS v1.0 (Round 4) per §2 of the Round 4 Handoff. Apply the maintainer answers from the Round 4 Decisions Document (this file)."*
