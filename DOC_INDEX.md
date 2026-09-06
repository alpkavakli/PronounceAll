# DOC_INDEX.md: PronounceAll documentation router

This file answers one question: **for a given task, which exact documents and sections should I read, and which can I ignore?** It does not restate requirements or decisions. Current documents live at the repository root; superseded documents live under `Deprecated Documents/`.

Retrieval discipline is defined in the root `CLAUDE.md`. This file supplies the map that discipline needs. Read this first, resolve the task to a domain, load only the listed IDs, and follow secondary references only when they materially affect the change.

---

## 1. Authority and precedence

The SRS and current SDD are the two primary implementation baselines. Foundational Decisions and Round 4 Decisions remain binding where the current baselines incorporate or reference them and have not explicitly superseded them. Other documents are scope inputs, history, process artifacts, or registers as classified below.

| Tier | Document | Owns |
|---|---|---|
| **Requirements baseline** | `SRS` (`PronounceAll_SRS_v1.0.md`) | What the system must do: `FR-*`, `NFR-*`, appendices |
| **Design baseline** | `SDD Round 1 Decisions` (`PronounceAll_SDD_Round1_Decisionsv1.0.3.md`) | How it is built: decisions `B1-B3`, `C1-C6`, `E1-E4`, `V1-V8`, and the amendment ledger |
| Input (fixed) | `Charter` (`PronounceAll_Project_Charter.md`) | Vision, scope in/out, success criteria `SC1-6`, licensing |
| Input (fixed) | `Handoff` (`PronounceAll_Handoff_Document.md`) | Locked feature brief, iteration order, document plan |
| Input (fixed) | `Foundational Decisions` (`PronounceAll_SRS_Foundational_Decisions.md`) | Security posture, auth model, anonymous identity, rate limits, deletion model (detail the SRS abstracts) |
| Input (fixed) | `Round 4 Decisions` (`PronounceAll_SRS_Round4_Decisions.md`) | The 16 settled values and their SDD implementation notes |
| Register | `Backlog & Findings` (`PronounceAll_Backlog_and_Findings.md`) | Deferred ideas `IDEA-*`, known defects `FIND-*` |
| Process (live) | `SDD Handoff` (`PronounceAll_SDD_Handoff.md`) | The SDD round plan; governs SDD Rounds 2 to 4. Not a source of requirements or design decisions |

**Precedence.** For *what to build*, the SRS wins. For *how to build it*, the SDD Round 1 Decisions win. Where a design decision changed a requirement, the change is recorded in the **SDD Decisions §6 amendment ledger** (14 items); that ledger is the reconciliation record between the two baselines, so the SRS text should already reflect it. The fixed inputs are not reopened; read them for detail and rationale, not to override a baseline.

**Conflict rule.** If the SRS and the SDD Decisions disagree and §6 does not explain the difference, **stop and report the conflict.** Do not pick a side silently. Never resolve a conflict using a superseded document (§6 below).

---

## 2. ID and heading schemes (what to search for)

- **SRS functional**, `FR-<AREA>-NN`, one section family each: `FR-WORD-*` (§4.1), `FR-IPA-*` (§4.2), `FR-SAVE-*` (§4.3), `FR-PRACTICE-*` (§4.4), `FR-AUTH-*` (§4.5), `FR-CONSENT-*` (§4.6), `FR-OSS-*` (§4.7), `FR-SET-*` (§4.8), `FR-CONTENT-*` (§4.9).
- **SRS non-functional**, `NFR-<AREA>-NN`: `NFR-SEC-*` (§5.1), `NFR-PERF-*` (§5.2), `NFR-A11Y-*` (§5.3), `NFR-PRIV-*` (§5.4), `NFR-OPS-*` (§5.5), `NFR-COMPAT-*` (§5.6), `NFR-I18N-*` (§5.7), `NFR-LEGAL-*` (§5.8).
- **SRS traceability** §6 (per area), **appendices** §7: A reserved usernames, B phoneme example words, C rate-limit reference, D cookie inventory, E PII inventory, F endpoint catalogue.
- **SDD decisions**: `B1-B3` blocking, `C1-C6` conventions, `E1-E4` content/algorithm, `V1-V8` vendor/infra, §6 ledger, §7 open items.

To find a requirement, grep the ID or the area family heading. Do not read a section family end to end; jump to the specific ID.

---

## 3. Domain routing table

Start set = the minimum IDs to load. Follow-if = load only when the change touches that concern.

| Domain | Start set | Follow-if |
|---|---|---|
| Word page render | `FR-WORD-03`, `E4` (pronunciation model), `B2` (shell+hydration cache) | `FR-IPA-*`, `NFR-PERF-04/05`, `FR-CONTENT-05` |
| Fuzzy 404 | `FR-WORD-04`, `E3` | none, self-contained |
| Word requests | `FR-WORD-05` | `NFR-SEC-*` rate limits, Appendix C |
| IPA / phonemes | `FR-IPA-*` (esp `FR-IPA-03`, `FR-IPA-08`), `E2`, Appendix B | `FR-SAVE-*` (phonemes reuse save), `FR-IPA-05/06` audio |
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
| DB / schema / migrations | `C3` (Flyway), `C5` (types), table's decision (`B1`/`B3`) | `NFR-PERF-05`, SDD Rounds 2-3 (schema, when written) |
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

These are consumed by SRS v1.0 or were one-time process handoffs. Reading them for implementation risks quoting values the merge already overrode. All of them live under `Deprecated Documents/`.

- `Deprecated Documents/PronounceAll_SRS(R2).md` (Round 2 SRS draft)
- `Deprecated Documents/PronounceAll_SRS_Round3.md` (Round 3 SRS draft)
- `Deprecated Documents/SRS_Round4_Handoff.md`, `Deprecated Documents/PronounceAll_SRS_Reading_QA_Handoff.md`, `Deprecated Documents/PronounceAll_Merge_and_Build_Handoff.md` (SRS process handoffs)
- `Deprecated Documents/PronounceAll_Handoff_Document.docx` (superseded by the amended `PronounceAll_Handoff_Document.md` at the root)

Read one of these only when explicitly investigating project history. Anything under `Deprecated Documents/` is non-authoritative. Note that two current root documents carry `Handoff` in their names and are not superseded: `PronounceAll_Handoff_Document.md` (binding input) and `PronounceAll_SDD_Handoff.md` (live process document).

---

## 7. Retrieval policy (pointer)

The full policy is in the root `CLAUDE.md`. Index-specific rules:

1. Resolve the task to a §3 domain before opening any spec file.
2. Load the start set by ID; expand along §4 chains only when the change touches that concern.
3. The SRS and current SDD are the primary baselines. Follow referenced Foundational and Round 4 Decisions where they remain in force; never use them to override a later explicit amendment or SDD/SRS resolution.
4. State the governing IDs (from §3/§5) before substantial implementation.
5. On a conflict not explained by the SDD Decisions §6 ledger, report it; do not resolve silently.
6. Skip §6 documents unless auditing history.

Keep this file current: when SDD Rounds 2-4 add the schema and flow sections, add their anchors to the DB/schema and merge/deletion rows.
