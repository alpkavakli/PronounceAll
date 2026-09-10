# DOC_INDEX.md: PronounceAll documentation router

This file answers one question: **for a given task, which exact documents and sections should I read, and which can I ignore?** It does not restate requirements or decisions. Current documents live under `docs/current/`; live process documents under `docs/process/`; superseded documents under `docs/archive/`; external references under `docs/references/`.

Retrieval discipline is defined in the root `CLAUDE.md`. This file supplies the map that discipline needs. Read this first, resolve the task to a domain, load only the listed IDs, and follow secondary references only when they materially affect the change.

---

## 1. Authority and precedence

The SRS and current SDD are the two primary implementation baselines. Foundational Decisions and Round 4 Decisions remain binding where the current baselines incorporate or reference them and have not explicitly superseded them. Other documents are scope inputs, history, process artifacts, or registers as classified below.

| Tier | Document | Owns |
|---|---|---|
| **Requirements baseline** | `SRS` (`docs/current/PronounceAll_SRS_v1.0.md`) | What the system must do: `FR-*`, `NFR-*`, appendices |
| **Design baseline (decisions)** | `SDD Round 1 Decisions` (`docs/current/PronounceAll_SDD_Round1_Decisionsv1.0.3.md`) | The settled *how*: decisions `B1-B3`, `C1-C6`, `E1-E4`, `V1-V8`, and the amendment ledger |
| **Design baseline (document)** | `SDD v1.1` (`docs/current/PronounceAll_SDD_v1_1.md`) | The design built on those decisions: §1-§9, including the data model (§4), the six key flows (§5), the cross-cutting mechanics (§6), the conventions (§7), and the Round 3 register `D-R3-01` to `D-R3-08` (§8) |
| **Design baseline (content)** | `en-US Phoneme Inventory v1` — the D4 artifact (`docs/current/PronounceAll_en-US_Phoneme_Inventory_v1.md`) | The canonical `en-us` symbol set, its transcription conventions, and the per-unit teaching examples. SDD v1.1 §4.2 and `D-R3-07` reference this artifact and make it authoritative for that content; it instantiates their frozen policy rather than adding to it |
| Input (fixed) | `Charter` (`docs/current/PronounceAll_Project_Charter.md`) | Vision, scope in/out, success criteria `SC1-6`, licensing |
| Input (fixed) | `Handoff` (`docs/process/PronounceAll_Handoff_Document.md`) | Locked feature brief, iteration order, document plan |
| Input (fixed) | `Foundational Decisions` (`docs/current/PronounceAll_SRS_Foundational_Decisions.md`) | Security posture, auth model, anonymous identity, rate limits, deletion model (detail the SRS abstracts) |
| Input (fixed) | `Round 4 Decisions` (`docs/current/PronounceAll_SRS_Round4_Decisions.md`) | The 16 settled values and their SDD implementation notes |
| Register | `Backlog & Findings` (`docs/process/PronounceAll_Backlog_and_Findings.md`) | Deferred ideas `IDEA-*`, known defects `FIND-*` |
| Process (live) | `SDD Handoff` (`docs/process/PronounceAll_SDD_Handoff.md`) | The SDD round plan; governs SDD Rounds 2 to 4. Not a source of requirements or design decisions |
| Process (live) | `Iteration 1 Handoff` (`docs/process/PronounceAll_Iteration1_Handoff.md`) | Implementation-phase state record and reading router for Iteration 1. Routes to IDs and records what Iteration 0 built. Not a source of requirements or design decisions |
| Process (live) | `Session Handoff 2026-09-11` (`docs/process/PronounceAll_Session_Handoff_2026-09-11.md`) | Resume point: what is built, what blocks Iteration 2, and the architecture traps. Not a source of requirements or design decisions |
| Process (live) | `Iteration 2 Completion` (`docs/process/PronounceAll_Iteration2_Completion.md`) | What Iteration 2 built and what remains — notably that phoneme audio is not yet generated. Not a source of requirements or design decisions |
| Process (live) | `Iteration 2 Handoff` (`docs/process/PronounceAll_Iteration2_Handoff.md`) | Implementation-phase state record and reading router for Iteration 2. Records what Iteration 1 built, and flags in its §0 that the D4 phoneme artifact the SDD treats as authoritative does not yet exist. Not a source of requirements or design decisions |

**Precedence.** For *what to build*, the SRS wins. For *how to build it*, the SDD Round 1 Decisions win; `SDD v1.1` elaborates those decisions into the design the implementation follows and does not override them (SDD v1.1 §1.3). Where the SDD document and a Round 1 decision appear to disagree, the decision governs and the disagreement is a defect to report. Where a design decision changed a requirement, the change is recorded in (15 items); that ledger is the reconciliation record between the two baselines, so the SRS text should already reflect it. The fixed inputs are not reopened; read them for detail and rationale, not to override a baseline.

**Conflict rule.** If the SRS and the SDD Decisions disagree and §6 does not explain the difference, **stop and report the conflict.** Do not pick a side silently. Never resolve a conflict using a superseded document (§6 below).

---

## 2. ID and heading schemes (what to search for)

- **SRS functional**, `FR-<AREA>-NN`, one section family each: `FR-WORD-*` (§4.1), `FR-IPA-*` (§4.2), `FR-SAVE-*` (§4.3), `FR-PRACTICE-*` (§4.4), `FR-AUTH-*` (§4.5), `FR-CONSENT-*` (§4.6), `FR-OSS-*` (§4.7), `FR-SET-*` (§4.8), `FR-CONTENT-*` (§4.9).
- **SRS non-functional**, `NFR-<AREA>-NN`: `NFR-SEC-*` (§5.1), `NFR-PERF-*` (§5.2), `NFR-A11Y-*` (§5.3), `NFR-PRIV-*` (§5.4), `NFR-OPS-*` (§5.5), `NFR-COMPAT-*` (§5.6), `NFR-I18N-*` (§5.7), `NFR-LEGAL-*` (§5.8).
- **SRS traceability** §6 (per area), **appendices** §7: A reserved usernames, B phoneme example words, C rate-limit reference, D cookie inventory, E PII inventory, F endpoint catalogue.
- **SDD decisions**: `B1-B3` blocking, `C1-C6` conventions, `E1-E4` content/algorithm, `V1-V8` vendor/infra, §6 ledger, §7 open items.
- **SDD v1.1 sections**: §2 actors and boundary, §3 architecture and module map, §4 data model (§4.2 catalogue, §4.3 identity, §4.4 event log, §4.5 derived state, §4.6 practice, §4.7 legal/consent, §4.8 indexing, §4.9 deletion privileges, §4.11 ERD, §4.12 resolved flags), §5 key flows (§5.1 merge, §5.2 save/tag write, §5.3 word page render, §5.4 practice, §5.5 deletion, §5.6 registration), §6 cross-cutting (§6.1 errors, §6.2 logging, §6.3 caching, §6.4 config/secrets, §6.5 jobs), §7 conventions, §8 register `D-R3-01` to `D-R3-08`, §9 deferrals.

To find a requirement, grep the ID or the area family heading. Do not read a section family end to end; jump to the specific ID.

---

## 3. Domain routing table

Start set = the minimum IDs to load. Follow-if = load only when the change touches that concern.

| Domain | Start set | Follow-if |
|---|---|---|
| Word page render | `FR-WORD-03`, `E4` (pronunciation model), `B2` (shell+hydration cache) | `FR-IPA-*`, `NFR-PERF-04/05`, `FR-CONTENT-05` |
| Fuzzy 404 | `FR-WORD-04`, `E3` | none, self-contained |
| Word requests | `FR-WORD-05` | `NFR-SEC-*` rate limits, Appendix C |
| IPA / phonemes | `FR-IPA-*` (esp `FR-IPA-03`, `FR-IPA-08`), `E2`, Appendix B, **D4** (`PronounceAll_en-US_Phoneme_Inventory_v1.md`) — the symbol set, transcription conventions, normalisation profile, and frequency-rank policy | `FR-SAVE-*` (phonemes reuse save), `FR-IPA-05/06` audio, `D-R3-07` |
| Save / tag | `FR-SAVE-03/04/05/08`, `B1`, `B3`, `C5` | `FR-AUTH-18` (merge), `NFR-PERF-05` |
| Event history / ordering | `FR-SAVE-03/04`, `C5` (event_id + occurred_at ordering) | `B1`, `FR-AUTH-18` |
| Anonymous identity | `FR-AUTH-01/03`, Foundational §6, `B1` | `FR-SAVE-05`, `NFR-PRIV-02` |
| Login / registration | `FR-AUTH-04/05/06/08/09/11`, Foundational §2/§7 | `V8` + Appendix A (username profanity), `FR-AUTH-16` (Google) |
| Sessions | `FR-AUTH-12`, `V3` (Redis session + MySQL `session_epoch`), `V2` | Foundational §2, `NFR-SEC-*` |
| Account merge | `FR-AUTH-18`, `FR-AUTH-19`, `B1`, `C5` | `FR-SAVE-03/04`, `B3` |
| Account deletion | `FR-SET-07/08`, `NFR-PRIV-01/02/03`, Appendix E, `B1`, `C6` | Foundational §8 |
| Privacy / retention | `NFR-PRIV-01/02`, Appendix E, Appendix D | `C6` (purge job), `B1` |
| Practice / SM-2 | `FR-PRACTICE-04/06`, Round 4 Decisions #1/#2 | `FR-SAVE-*` (queue source) |
| Content ingestion | `FR-CONTENT-01/04/05`, `E1`, `E4` | `V1` (TTS), `V4` (storage) |
| TTS / audio / licensing | `V1`, `FR-CONTENT-04/05`, `FR-IPA-05/06`, `NFR-LEGAL-*`, Charter §7 | `V4`, `C6` (batch job) |
| Caching / performance | `NFR-PERF-04/05`, `B2`, `V4` | `NFR-PERF-07/08` |
| Logging / errors | `C1` (pino), `C2` (AppError), `NFR-SEC-10`, `NFR-OPS-04` | none |
| Background jobs | `C6` (BullMQ), `C4` (services/idempotency) | the job's own domain (deletion `FR-SET-08`, purge `NFR-PRIV-02`, reconciliation `B3`, TTS `V1`) |
| DB / schema / migrations | `C3` (Flyway), `C5` (types), SDD v1.1 §4 (the table's own subsection), §7.2 (naming), table's decision (`B1`/`B3`) | `NFR-PERF-05`, SDD v1.1 §4.8 (indexing), §4.9 (deletion privileges) |
| Deployment / backups | `V6` (backups), `V7` (region), `V2`, `V5`, `NFR-OPS-01` | Charter §5/§8, Foundational |
| Accessibility | `NFR-A11Y-*`, Charter `SC4` | the affected feature's `FR-*` requirements |
| Security | the specific `NFR-SEC-NN` for the affected surface (search the family, do not load it whole), Foundational §2/§9/§10 | Appendix C (rate limits), `C1` (redaction), `V3` |

---

## 4. Cross-document dependency chains

Follow these when a change is not self-contained. Each arrow is a real relationship; loading the whole chain prevents missing a governing constraint without reading whole documents.

- **Merge & identity:** `FR-AUTH-18/19` → `FR-SAVE-03/04` → `B1` (append-only `identity_bindings`) → `C5` (ordering) → `FR-SET-08` (erasure) → `NFR-PRIV-02` + Appendix E.
- **Word page:** `FR-WORD-03` → `FR-IPA-*` → `E4` (pronunciation model, `is_primary`/`display_order`) → `B2` (cacheable shell + hydration) → `NFR-PERF-04/05`.
- **Content → audio → licensing:** `E1` (seed pipeline) → `FR-CONTENT-04/05` (provenance + attribution) → `V1` (Piper/`en_US-libritts-high`, licensing residual) → Charter §7 / `NFR-LEGAL-*`.
- **Background jobs:** `C6` (BullMQ) → `C4` (thin adapter calls a service; idempotency is business-level) → {`FR-SET-08` deletion, `NFR-PRIV-02` purge, `B3` reconciliation, `V1` TTS batch}.
- **Deletion → privacy:** `FR-SET-07/08` → `NFR-PRIV-01/02/03` → Appendix E → `B1` (bindings erased) → `C6` (narrow erasure credential).

---

## 5. Task recipes (minimum reading sets)

- **Login / session handling:** `FR-AUTH-04/05/06/08/09/11`, Foundational §2/§7, `V3`, `V2`. Add `FR-AUTH-18` + `B1` only if anonymous merge is in scope.
- **Account deletion:** `FR-SET-07/08`, `NFR-PRIV-01/02/03`, Appendix E, `B1`, `C6`.
- **Word page:** `FR-WORD-03`, `FR-IPA-*`, `E4`, `B2`, `NFR-PERF-04/05`.
- **Fuzzy 404:** `FR-WORD-04`, `E3`. Nothing else.
- **Save / tag write path:** `FR-SAVE-03/04/05/08`, `B1`, `B3`, `C5`.
- **TTS batch generation:** `V1`, `FR-CONTENT-04/05`, `C6`, `V4`.
- **New schema migration:** `C3`, `C5`, the affected table's decision (`B1`/`B3`), `NFR-PERF-05`.

---

## 6. Superseded and process documents: do not implement from these

These are consumed by SRS v1.0 or were one-time process handoffs. Reading them for implementation risks quoting values the merge already overrode. All of them live under `docs/archive/`.

- `docs/archive/PronounceAll_SRS(R2).md` (Round 2 SRS draft)
- `docs/archive/PronounceAll_SRS_Round3.md` (Round 3 SRS draft)
- `docs/archive/SRS_Round4_Handoff.md`, `docs/archive/PronounceAll_SRS_Reading_QA_Handoff.md`, `docs/archive/PronounceAll_Merge_and_Build_Handoff.md` (SRS process handoffs)
- `docs/archive/PronounceAll_Handoff_Document.docx` (superseded by the amended `docs/process/PronounceAll_Handoff_Document.md`)

Read one of these only when explicitly investigating project history. Anything under `docs/archive/` is non-authoritative. Note that two documents under `docs/process/` carry `Handoff` in their names and are not superseded: `PronounceAll_Handoff_Document.md` (binding input) and `PronounceAll_SDD_Handoff.md` (live process document).

---

## 7. Retrieval policy (pointer)

The full policy is in the root `CLAUDE.md`. Index-specific rules:

1. Resolve the task to a §3 domain before opening any spec file.
2. Load the start set by ID; expand along §4 chains only when the change touches that concern.
3. The SRS and current SDD are the primary baselines. Follow referenced Foundational and Round 4 Decisions where they remain in force; never use them to override a later explicit amendment or SDD/SRS resolution.
4. State the governing IDs (from §3/§5) before substantial implementation.
5. On a conflict not explained by the SDD Decisions §6 ledger, report it; do not resolve silently.
6. Skip §6 documents unless auditing history.

Keep this file current. SDD Rounds 2 to 4 are complete and merged as `SDD v1.1`; its section anchors are recorded in §2 above. When a later document changes location or authority, update §1 and §2 here, and leave the precedence rules alone unless the authority itself has actually changed.
