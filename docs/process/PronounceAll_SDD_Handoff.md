# PronounceAll — SDD Handoff

**Version:** 1.0
**Status:** Approved plan. SDD Round 1 not started.
**Owner:** Alp K. (solo developer)
**Purpose:** Compaction of the SDD planning chat. This document is the authoritative instruction set for the SDD chats. Paste it, together with the documents listed in §9, into a fresh chat to begin SDD Round 1.

**Preceding milestone:** SRS v1.0 was produced by merging Round 2 and Round 3 and applying the 16 Round 4 maintainer decisions. Cross-reference sweeps passed with zero orphans. SRS v1.0 is the authoritative requirements baseline for everything below.

---

## 1. What exists today

| Artifact | Status | Notes |
|---|---|---|
| Project Charter v1.0 | Approved | Vision, scope, success criteria, licensing |
| Project Handoff Document v1.0 | Approved, amendment pending | See §8 of this document |
| SRS Foundational Decisions (Round 1) | Complete | Security posture, auth, anonymous identity, rate limits |
| SRS Round 4 Decisions | Complete | The 16 settled values plus implementation notes for the SDD |
| **SRS v1.0 (merged)** | **Approved pending sign-off** | §1 to §7, 81 FRs, 66 NFRs, traceability matrix, Appendices A to F |
| Backlog and Findings Register | Live | Holds FIND-01 and other deferred items |
| Use Case Diagram and Descriptions | **Folded into the SDD** | See §3 and §8 |
| ERD and Database Schema | **Folded into the SDD** | See §3 and §8 |
| Phoneme example-word list | **Promoted to a standalone artifact** | Referenced by the SDD, drafted separately |
| SDD | **Not started. This is the next deliverable.** | |

Counts worth carrying forward, because earlier handoffs cite different figures: the merged SRS contains **81 FRs** (not 80) and **66 NFRs**. The extra FR is FR-PRACTICE-07, an out-of-scope `Won't` marker that occupies an FR identifier. Nothing is missing.

---

## 2. Decisions settled in the SDD planning chat

These are binding for the SDD chats and are recorded here so they are not re-litigated.

**D1. The SDD absorbs the Use Case document.** A compact section of roughly two pages, containing the actor list, a system boundary diagram, and a table mapping use cases to FR ranges. It does not become the five-page standalone document the master Handoff originally specified. Rationale: the 81 FRs already encode every use case in testable form, so a separate document would be duplication, but the Threat Model will want a boundary picture and it is cheaper to draw it once here.

**D2. The SDD absorbs the ERD and database schema.** Splitting a conceptual model from a physical schema serves a handoff between separate people. There is one person. Keeping them together places the schema next to the flows that justify it and removes a seam where the two documents could drift.

**D3. The API Specification, Threat Model, and Security Controls document remain separate.** The OpenAPI file is a machine-readable working artifact belonging in the repository. The other two serve a different reader and a different review moment.

**D4. The phoneme example-word list is a standalone artifact, referenced by the SDD.** It is drafting and content work rather than design work, and roughly 44 phonemes with example words would distort the SDD if embedded. The SDD names the artifact, states its purpose and its sourcing standard, and points to it.

**D5. Page count is not a target.** The document is sized by what changes the code. Sections that earn length: the data model, the three blocking design decisions, the sequence diagrams for hard flows, and the cross-cutting conventions. Sections that do not: technology stack justification already argued in the Charter and Handoff, walkthroughs of trivial subsystems such as settings pages and the open-source banner, and rationale that restates the SRS. The expected result is roughly twenty to twenty-five pages, as a consequence rather than a goal.

**D6. Iteration 0 does not begin until the SDD is complete.** Design before code, consistent with the project method.

**D7. No contradicting documents.** When a decision changes something already written elsewhere, the amendment to the affected document is produced at the same time, not deferred. Small changes to settled documents are acceptable and expected. The project is agile in the sense that documents are revised as understanding improves; it is not agile in the sense of skipping design.

**D8. NFR-OPS-04 stands as merged.** Application logs 90 days at launch reducing to 30 when stable, access logs 30 days. Reviewed and deliberately left unchanged.

---

## 3. SDD structure

1. **Introduction and scope.** Purpose, readership, relationship to Charter and SRS v1.0, and a pointer rather than a restatement for the technology stack.
2. **Actors, system boundary, and use cases.** Actors: Anonymous Visitor, Registered User, Administrator, Google OAuth Provider, Wiktionary API, TTS Provider. Mermaid boundary diagram. Use case table mapped to FR ranges.
3. **Architectural overview and component decomposition.** Runtime topology across Cloudflare, Nginx, Express, MySQL, and Redis. Module boundaries and their responsibilities.
4. **Data model.** Conceptual model, full table-by-table schema, Mermaid `erDiagram`, indexing strategy, and the derived-state design.
5. **Key flows.** Six sequence diagrams, listed in §5 of this document.
6. **Cross-cutting design.** Error taxonomy and surfacing, logging strategy and PII redaction, caching, configuration and secrets, and the background job model.
7. **Directory structure and coding conventions.**
8. **Design decisions register.** Each decision with alternatives considered and rationale.
9. **Deferrals to downstream documents.** Explicit, so the API Specification, Threat Model, and Security Controls do not arrive empty.

---

## 4. Round structure

The SRS proved that a single chat cannot carry a document of this size. The SDD follows the same pattern.

**Round 1 — Decisions.** A question batch covering §6 of this document, answered before any drafting. Output is an SDD Decisions Document in the same shape as the SRS Round 4 Decisions file: decision, rationale, and an implementation note where one is useful.

**Round 2 — Architecture and cross-cutting.** SDD sections 1, 2, 3, 6, and 7.

**Round 3 — Data model and key flows.** SDD sections 4 and 5.

**Round 4 — Merge, sweep, table of contents.** Mechanical. No new content. Sweeps every FR and NFR citation against SRS v1.0 and confirms no requirement referenced by the design has been renamed or dropped.

Rounds 2 and 3 are split this way rather than by page count because component and data design depends on the conventions fixed in Round 2. Writing schema and flows before the error handling and logging strategy exists produces inconsistency that has to be unwound later.

---

## 5. The six sequence diagrams

Only flows whose difficulty justifies a diagram are drawn. Ordinary request and response paths are described in prose.

1. **Anonymous to registered merge.** Covers FR-AUTH-18 and the conflict in §7 of this document.
2. **Save or tag write.** Idempotency window per FR-SAVE-08, event append, derived-state update.
3. **Word page render.** Audio fallback chain (Wiktionary recording, then pre-generated TTS, then Web Speech API) and whatever caching decision Round 1 produces.
4. **Practice session lifecycle.** Queue construction, self-assessment, SM-2 state update with the 5 and 2 quality mapping, reinsertion, and the 60 minute idle termination.
5. **Account deletion.** Soft delete with the 30 day grace period through hard delete and cascade, including the interaction with the append-only event log.
6. **Registration across the three paths.** Google OAuth, email with verification, and username with optional email, with attention to the email collision and account linking cases.

---

## 6. SDD Round 1 decision inventory

### 6.1 Blocking. These constrain everything else and are answered first.

- **The event-log conflict.** Stated in full in §7. Determines the shape of `user_activity_events` and therefore most of the data model.
- **Caching strategy for personalised pages.** Word pages are server-rendered and display per-viewer save and tag state, so they cannot be edge-cached as rendered. NFR-PERF-04 distinguishes cached from uncached time to first byte, which presumes some caching exists. Candidate approaches: a cacheable shell hydrated by a small client-side state request; edge caching keyed on an anonymous-state hint; or accepting that only anonymous first-visit pages cache. This is the largest architectural decision in the document and it constrains Iteration 1.
- **Derived-state maintenance.** Whether `user_word_states` and `user_phoneme_states` are written in the same transaction as the event or rebuilt by a job. Affects consistency guarantees, the FR-SAVE-08 idempotency window, and practice queue construction.

### 6.2 Vendor and infrastructure. Previously deferred by the Charter, Handoff, and Foundational Decisions.

- TTS provider (Google Cloud, Azure, AWS Polly), evaluated against current free-tier quotas and, importantly, the output licensing terms, given that generated audio becomes CC BY-SA 4.0 project content
- Transactional email provider (Brevo, Resend, SMTP2GO)
- Hetzner region (Helsinki, Nuremberg, Ashburn)
- Off-site backup target satisfying NFR-OPS-01 (Hetzner Storage Box, Backblaze B2, or equivalent)
- Redis deployment shape, already required for rate-limit counters per Foundational Decisions §10.3 and for the 30 second idempotency store
- Session store selection
- Audio asset storage and serving path for pre-generated TTS files
- Profanity blocklist package for FR-AUTH-05 and Appendix A

### 6.3 Cross-cutting conventions.

- Logging library, log format, and PII redaction rules sufficient to satisfy NFR-OPS-04 and the privacy NFRs
- Error taxonomy, and how errors surface differently in server-rendered EJS responses and in JSON endpoints
- MySQL migration tooling
- Directory structure and module boundaries
- Event timestamp column type. The Round 4 Decisions sketch `DATETIME(3)`, `TIMESTAMP(3)`, or a `BIGINT` Unix-milliseconds column, with auto-increment event ID as a design-time fallback tie-breaker.
- Background job model and scheduler, covering the NFR-PRIV-02 two year dormancy purge, the deletion worker, and TTS batch pre-generation

### 6.4 Content and algorithms.

- Sourcing standard and review process for the phoneme example-word artifact
- Fuzzy-match algorithm for the word page 404 suggestion path
- Seed data ingestion pipeline design, which per the FR-WORD-10 architectural note must make adding a language variant a row insert plus a content batch run rather than a code change

---

## 7. The blocking conflict, stated in full

SRS v1.0 carries an unresolved conflict, deliberately left in place because the resolution is a schema decision.

**FR-SAVE-03** requires that the application role hold only `INSERT` and `SELECT` privileges on `user_activity_events`, with `UPDATE` and `DELETE` granted solely to the deletion worker. This is what makes the log genuinely append-only rather than append-only by convention.

**FR-AUTH-18** requires that, when an anonymous profile is merged into a newly registered account, the existing rows have their `anonymous_id` re-pointed to the user. Re-pointing is an `UPDATE` performed by the application during registration.

The two cannot both hold as written. Candidate resolutions, none of which is chosen here:

- Grant a narrowly scoped merge worker `UPDATE` privilege limited to the `anonymous_id` column, preserving append-only semantics for event payloads while admitting a controlled exception
- Do not re-point at all. Retain a mapping from `anonymous_id` to `user_id` and resolve identity at read time through a join, leaving the event rows fully immutable
- Append a merge event and derive the identity relationship from the log itself, treating the mapping as derived state like every other projection

The second and third preserve the append-only property strictly. The first is simpler to implement and query. The choice affects the deletion worker, the erasure guarantees promised under GDPR and KVKK, and the merge sequence diagram. Resolve this before anything else in Round 1.

**Related open item:** FIND-01 in the Backlog and Findings Register records that FR-IPA-08 carries an acceptance criterion that cannot be satisfied as written. It is not an SDD blocker, but the SDD chat should confirm the design does not depend on that criterion being achievable.

---

## 8. Amendments to the Project Handoff Document

Decisions D1, D2, and D4 contradict the master Handoff as currently written. Per D7, apply these before starting SDD Round 1. Line numbers refer to the Markdown export; the same strings appear in the `.docx`.

**Edit 1. Phase 0 document list, line 147. Remove the standalone Use Case entry.**

Find:
```
3. **Use Case Diagram + Descriptions** — 5 pages. Actors: Anonymous Visitor, Registered User, Administrator, Google OAuth Provider, Wiktionary API, TTS Provider. Mermaid diagram + description table per use case.
```
Replace with:
```
3. *(Removed. Use case content is folded into the SDD as a compact section; see Phase 1.)*
```

**Edit 2. Phase 1 SDD entry, line 151. Restate scope and remove the page target.**

Find:
```
1. **Software Design Document (SDD)** — 30–40 pages. Architectural overview, component-by-component design, design decisions with rationale, data flow diagrams, technology stack justification, directory structure, coding conventions, error handling strategy, logging strategy.
```
Replace with:
```
1. **Software Design Document (SDD)** — sized by content, not page target. Introduction and scope; actors, system boundary, and use case table; architectural overview and component decomposition; data model including full schema and ERD; sequence diagrams for the six hard flows; cross-cutting design (errors, logging, caching, configuration, secrets, jobs); directory structure and coding conventions; design decisions register; deferrals to downstream documents.
```

**Edit 3. Phase 1 ERD entry, line 152. Fold into the SDD.**

Find:
```
2. **ERD + Database Schema** — 5 pages. Mermaid erDiagram plus table-by-table schema. Planned tables:
```
Replace with:
```
2. *(Folded into the SDD, section 4.)* Mermaid erDiagram plus table-by-table schema. Planned tables:
```

The table list that follows on the same line is retained unchanged.

**Edit 4. Open Questions, line 203. Promote the phoneme list to a standalone artifact.**

Find:
```
* Phoneme example-word list — will be drafted during SDD using Cambridge/Wiktionary references; ideally reviewed by a phonetician before launch
```
Replace with:
```
* Phoneme example-word list — a standalone artifact referenced by the SDD, drafted using Cambridge/Wiktionary references; ideally reviewed by a phonetician before launch
```

**Edit 5. Completed Documents index, line 220.**

Find:
```
**[Use Case Diagram + Descriptions]** — *pending* **[SDD]** — *pending* **[ERD + Database Schema]** — *pending*
```
Replace with:
```
**[SDD (incl. use cases + ERD)]** — *pending* **[Phoneme Example-Word List]** — *pending*
```

**Edit 6. Dependency note, line 137.**

Find:
```
The design phase (SDD + ERD + API Spec) must anticipate all seven iterations
```
Replace with:
```
The design phase (SDD + API Spec) must anticipate all seven iterations
```

Also mark the SRS as complete in the Completed Documents index when convenient, since SRS v1.0 now exists.

---

## 9. Documents to upload to the SDD chats

**Required for every SDD round:**

1. This handoff (`PronounceAll_SDD_Handoff.md`)
2. `PronounceAll_SRS_v1.0.md` — the authoritative requirements baseline
3. `PronounceAll_Project_Charter.md`
4. `PronounceAll_Handoff_Document` — with the §8 amendments applied
5. `PronounceAll_SRS_Foundational_Decisions.md` — security posture, auth model, anonymous identity, rate-limit table, all of which the design must implement rather than revisit
6. `PronounceAll_SRS_Round4_Decisions.md` — carries implementation notes written specifically for the SDD
7. `PronounceAll_Backlog_and_Findings.md`

**Additionally, from Round 2 onward:**

8. The SDD Decisions Document produced by Round 1

**Additionally, for Round 4:**

9. The Round 2 and Round 3 SDD drafts

**Do not upload:** the superseded Round 2 and Round 3 SRS files, the SRS Round 4 Handoff, the Reading and Q and A Handoff, or the Merge and Build Handoff. All are consumed by SRS v1.0 and uploading them invites quoting placeholder values that the merge already overrode.

---

## 10. Working conventions

- **Foundational Decisions are not reopened.** If a design question appears to challenge a Round 1 decision, acknowledge it, point to where it was decided, and confirm whether a formal revisit is wanted. Do not reopen casually.
- **The SRS is not rewritten by the SDD.** If the design reveals a requirement defect, record it in the Backlog and Findings Register and produce the SRS amendment separately, per D7.
- **Edits are delivered as copy-paste-ready find-and-replace pairs**, file by file, with pauses between files. The maintainer applies them manually.
- **Verification is a separate chat** from implementation.
- **Explanations of unfamiliar terms are welcome and expected**, layered from first principles with PronounceAll-specific examples.
- **Factual claims about standards are verified against primary sources**, not summaries. OWASP ASVS v5.0.0, NIST SP 800-63B Rev 3, WCAG 2.2, and Unicode block documentation are the pinned references.
- **Assessments are honest and direct.** No padding, no unrequested scope.

---

## 11. Instruction for the next chat

Upload the documents in §9, then instruct:

> Produce the SDD Round 1 question batch per §6 of the SDD Handoff. Start with the three blocking decisions in §6.1, and present the event-log conflict from §7 first with its candidate resolutions and their consequences. For each question, give the options, the tradeoffs, and a recommendation. Do not draft any part of the SDD in this chat.

---

*End of SDD Handoff. Next deliverable: SDD Round 1 Decisions Document.*
