# PronounceAll SRS — Round 4 Handoff

**Purpose of this document:** Compaction of the chat where Rounds 2 and 3 were reviewed and Round 4 questions were assembled. Paste this — together with the Charter, Handoff Document, Foundational Decisions, the Round 2 SRS file, and the Round 3 file — into a fresh chat to produce SRS Round 4.

**Status going into Round 4:** All inline decisions enumerated below are awaiting maintainer answers. Once answered, Round 4 produces SRS v1.0 as a single merged file.

---

## 1. What exists today

| Artifact | Status | Location / how to supply to next chat |
|---|---|---|
| Project Charter v1.0 | Approved | Project file (`PronounceAll_Project_Charter.md`) |
| Project Handoff Document v1.0 | Approved | Project file (`PronounceAll_Handoff_Document.docx`) |
| SRS Foundational Decisions (Round 1) | Complete | Upload `PronounceAll_SRS_Foundational_Decisions.md` |
| SRS Round 2 — §1–§4 with 80 FRs across 9 areas | Complete | Upload `PronounceAll_SRS.md` (this is the Round 2 deliverable, despite the unversioned filename) |
| SRS Round 3 — §5 NFRs (~60 across 8 categories), §6 traceability matrix, §7 appendices | Complete | Upload `PronounceAll_SRS_Round3.md` (was generated in a prior chat, output file) |
| SRS Round 4 — merge + polish + ToC | **Not started** — this is the next deliverable |

The Round 2 file already contains §1 Introduction, §2 Overall description, §3 Requirements conventions, §4 Functional requirements (areas 4.1–4.9). The Round 3 file is structured as `§5 + §6 + §7` to be inserted after §4 in Round 2.

## 2. What Round 4 must do

1. **Merge** Round 3 into Round 2 to produce a single SRS file containing §1 through §7 in order, with Round 3's "Merge instructions" section removed (it has served its purpose).
2. **Apply the 16 maintainer decisions** from §3 below — each is annotated at the point of use in Rounds 2 and 3, so applying an answer is a single-location edit per item.
3. **Sweep cross-references.** Every FR-XX-YY citation in §5–§6 must point to a requirement that still exists in §4. Every NFR-XX-YY citation in §6 must point to a requirement that still exists in §5. Every Charter SC reference in §6 must match the actual Charter §4 numbering.
4. **Tighten wording.** Round 3's drafting notes flag stylistic inconsistencies — eliminate any remaining "shall be designed so that…" phrasings in favour of testable "shall …", and make sure every requirement reads as a single sentence followed by optional rationale and acceptance criteria.
5. **Produce a complete table of contents** covering §1–§7 at the top of the merged file, replacing Round 2's partial ToC.
6. **Replace the version header** with `Version: 1.0` and `Status: Approved (pending maintainer sign-off)`. Add a brief changelog entry: `1.0 — Merge of Rounds 2+3, with Round 4 maintainer decisions applied.`

Round 4 does **not** rewrite content. It does **not** add new requirements. It does **not** revisit Foundational Decisions. Anything beyond merge + apply-decisions + sweep + ToC is out of scope.

## 3. The 16 maintainer decisions (Round 4 inputs)

Each item: requirement ID, current default value, the alternatives that were on the table, and a one-line note on the tradeoff. The maintainer answers each as either "default" / "override to X" / globally "all defaults".

### 3.1 From Round 2 — functional requirements

1. **FR-PRACTICE-04 — SM-2 quality mapping for self-assessment.** Default: "right" → quality 4, "wrong" → quality 2. Alternatives: 5/2 (more forgiving — easy words drift further out), 3/1 (harsher — wrong answers reset more aggressively).

2. **FR-PRACTICE-06 — Practice session idle timeout.** Default: 30 minutes (matches auth session idle). Alternatives: 15 min (frees session rows sooner), 60 min (more forgiving for users walking away).

3. **FR-WORD-10 — Seed dictionary size at launch.** Default: ≥ 5,000 American-English headwords. Handoff said "~100" for Iteration 1 but expects v1.0 to be useful. Alternatives: 1,000 (faster but weaker), 10,000+ (more useful but stresses TTS free tier and QA).

4. **FR-AUTH-05 / Appendix A — Reserved-username list.** Default: drafted inline (admin, root, api, settings + a small route/brand-squat list). Question: keep as-is, or extend (admin synonyms, profanity, maintainer's own handle). Easy to extend via config file.

5. **FR-SAVE-08 — Save idempotency window.** Default: 30 seconds. Duplicate POST with same idempotency key inside this window is ignored. Alternatives: 5 s (tighter, riskier on flaky mobile), 5 min (looser, more dedup-store memory).

6. **FR-SAVE-09 — `audio_listen` events priority.** Default: Should. Captures data now for post-v1.0 "your weakest phonemes" analytics. Alternatives: Must (forces test coverage), drop entirely from v1.0 (cleaner if analytics is uncertain).

7. **FR-AUTH-18 — Merge tie-breaker on identical-second timestamps.** Default: registered-user event wins. Alternatives: anonymous wins (preserves the in-progress action triggering merge), upgrade to millisecond precision and call it impossible. Threat-modelled either way.

### 3.2 From Round 3 — non-functional requirements

8. **NFR-PRIV-02 — Anonymous profile dormancy retention.** Default: 2 years of inactivity, then purged (matches cookie sliding `Max-Age`). Alternatives: 1 year (tighter privacy), 3 years (looser).

9. **NFR-OPS-01 — Backup retention schedule.** Default: daily × 30 days + weekly × 26 weeks. Alternative: weekly × 13 weeks if off-site storage cost is tight. No formal RPO; maintainer can set one if desired.

10. **NFR-OPS-04 — Application log retention.** Default: 30 days. Alternatives: 90 days (helps incident response — common ceiling before GDPR storage-limitation friction kicks in without security rationale), 7 days (minimal).

11. **NFR-SEC-02 — HSTS `max-age`.** Default: 6 months (15,552,000 s) with `preload`. Alternative: start at 1 month and step up before launch (cleaner rollback during config churn) → ship at 6 months immediately (cleaner state, harder to roll back).

12. **NFR-PERF-04 — TTFB p95 budget.** Default: 200 ms cached / 400 ms uncached at origin. Modest for a single VPS. Will be tightened after Iteration 7 load-test baselines.

13. **NFR-PERF-05 — DB query budget.** Default: 50 ms p95 on word-page composition. Reasonable for indexed reads on MySQL 8 at launch volume. Revisit if seed dataset grows 10×.

14. **NFR-PERF-07 — Page weight budget.** Default: 150 KB word page / 200 KB `/learnIPA`, excluding audio and fonts. Discipline target, not industry-average.

15. **NFR-PERF-08 — Load test profile.** Default: 50 concurrent anonymous + 5 concurrent practicing × 10 min. Modest for a solo-dev public launch. Scale up only if launch marketing plans imply real traffic.

16. **NFR-OPS-06 — Availability commitment.** Default: best-effort, no SLA. Tighter requires a second pair of hands. Alternative: soft target (e.g. "99% monthly, best-effort").

### 3.3 Conventions, not decisions (auto-applied during Round 4 sweep)

- Round 3 §6 "—" entries under Charter SC mean the FR/NFR serves supporting goals (robustness, operability, input hygiene) rather than a named Charter criterion. Documented; no action.
- Round 3 "TM pending" annotations placeholder-link to a Threat Model that doesn't exist yet. Round 4 leaves these unchanged; Threat Model document (later in the Handoff sequence) will replace them.

## 4. Notes for the next chat

- **Do not redraft anything that already exists.** Both Round 2 and Round 3 are complete. Round 4 is mechanical merge + apply-decisions + sweep + ToC. If you find yourself drafting new requirements or rewriting paragraphs, you've gone off-spec.
- **The Round 3 file's "Merge instructions" section** explains exactly where §5–§7 plug in (immediately after `### 4.9 Content & data seeding — FR-CONTENT-*` and before Round 2's footer). Follow that.
- **The Round 3 file's "drafting notes" section at the end is not part of the merged SRS.** It exists only to document inline decisions for this Round 4 step. Drop it from the merged output (its content has been consolidated into §3 of this handoff).
- **Output format:** single Markdown file. The maintainer wants `.md` for git diffing, not `.docx`.
- **FR/NFR style is locked** by Foundational Decisions §1: hybrid `shall`-statement + MoSCoW priority + rationale where non-obvious + acceptance criteria on non-trivial items. Trivial requirements get only shall + priority. Don't change this style during the polish sweep.

## 5. Recap of what happened in the previous chat

- Maintainer asked the previous Claude to "continue" without context. Previous Claude searched conversation history, found the planning chats but not the completion chats, mistook the SRS as not-yet-started, and produced a redundant §1–§2 draft (now deleted from outputs).
- Maintainer pushed back. Claude searched outputs directly, discovered the Round 3 file already existed from a prior session, and re-presented it.
- Claude assembled this handoff (the 16 questions plus current state) so Round 4 can proceed in a clean chat.
- Lesson for Round 4 chat: every artifact you need is named in §1 above. If something seems missing, ask before producing.

## 6. The maintainer's instruction to the Round 4 chat

> Paste: Charter, Handoff Document, Foundational Decisions, Round 2 SRS, Round 3 SRS, this Handoff. Then: "Produce SRS v1.0 (Round 4) per §2 of the Round 4 Handoff. My answers to the 16 decisions are: [LIST]."

The maintainer fills in the 16 answers in that final instruction line — either item-by-item or "all defaults" — and the next Claude has everything it needs to produce a single merged SRS v1.0 file in one pass.

---

*End of Round 4 handoff.*
