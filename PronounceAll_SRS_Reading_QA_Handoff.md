# PronounceAll SRS — Reading & Q&A Handoff

**Purpose of this document:** Compaction of the chat where Round 4 decisions were finalized. The maintainer (Alp K.) will now read the Round 2 and Round 3 SRS files and ask clarifying questions in a fresh chat. This document gives the next Claude instance everything it needs to answer those questions accurately without re-asking what's already settled.

**Status going into the next chat:**
- Foundational Decisions (Round 1) — complete.
- Round 2 SRS (FRs) — complete, in `PronounceAll_SRS.md`.
- Round 3 SRS (NFRs + traceability matrix + appendices) — complete, in `PronounceAll_SRS_Round3.md`.
- Round 4 Decisions — **complete**, in `PronounceAll_SRS_Round4_Decisions.md`. All 16 open items have been answered.
- Round 4 drafting (the actual merge into SRS v1.0) — **not yet started, intentionally deferred** so the maintainer can read R2 and R3 first and surface any wording/clarity issues before the polish sweep.

---

## 1. The maintainer's situation in plain language

Alp K. is solo dev on PronounceAll, working through a structured Phase 0 documentation set with Claude assistance. He is **not deeply technical in some areas** — specifically, security/ops topics (HSTS, TLS, Cloudflare modes, certs) and some performance-budget concepts had to be explained from scratch in the previous chat. Expect questions in those areas. He is sharp on philosophy, structure, scope discipline, and on calling out when something is off-spec.

He will be reading two large SRS files and asking questions about specific requirements he doesn't fully understand. **He is the audience for those questions — explain things clearly, with examples, not with jargon.** When jargon is unavoidable, define it the first time it appears.

He prefers:
- Direct, terse responses. No padding.
- Forward motion over explanation of past mistakes.
- Honest "I don't know" or "good catch" over deflection.
- Concrete examples and tables over abstract prose.
- Copy-paste-ready edits when something needs changing (find-and-replace pairs with exact current and replacement text). **Do not edit files directly unless asked.**

He does not want surprise scope creep. If he asks a clarifying question and you spot something *else* that looks wrong nearby, mention it briefly but separately — don't conflate it with answering the question.

---

## 2. Files the next chat needs

The maintainer will paste these into the new chat:

| File | Role |
|---|---|
| `PronounceAll_Project_Charter.md` | Vision, scope, success criteria. Authoritative for what's in/out of v1.0. |
| `PronounceAll_Handoff_Document.docx` | Feature Brief v0.1 (Locked) + the master document plan + iteration order. Authoritative for locked architectural decisions. |
| `PronounceAll_SRS_Foundational_Decisions.md` | Round 1 decisions: security posture (OWASP ASVS L2), audience (global / EU-first GDPR), perf floor (CWV "Good"), browser support (2022+ evergreens), anonymous identity model, registration paths, deletion (soft/hard), Cloudflare Turnstile, rate limits. |
| `PronounceAll_SRS.md` | **Round 2 SRS** — §1 Introduction, §2 Overall description, §3 Conventions, §4 Functional Requirements (80 FRs across 9 areas: WORD, IPA, SAVE, PRACTICE, AUTH, CONSENT, OSS, SET, CONTENT). |
| `PronounceAll_SRS_Round3.md` | **Round 3 SRS** — §5 Non-Functional Requirements (~60 across 8 categories: SEC, PERF, A11Y, PRIV, OPS, COMPAT, I18N, LEGAL), §6 traceability matrix, §7 appendices. |
| `SRS_Round4_Handoff.md` | Compaction of the prior planning chat. Lists the 16 open items that became the Round 4 questions. |
| `PronounceAll_SRS_Round4_Decisions.md` | **The 16 maintainer answers**, with full rationale. This is the source of truth for any FR or NFR value that's marked as "default" or "TBD" in R2/R3. |

---

## 3. Critical reading rules for the next chat

### 3.1 R2 and R3 contain unresolved placeholders. The Decisions Document overrides them.

When R2 says "FR-PRACTICE-04 default: right→4, wrong→2", the **actual ship value** is right→5, wrong→2 (per Decision #1 in the Decisions Document). Same pattern for all 16 items. If the maintainer asks "what does FR-PRACTICE-04 say about SM-2 scoring?", the correct answer is the Decisions Document value, not the R2 placeholder. **Never quote R2/R3 placeholders as if they were final.**

The 16 items that were open and are now resolved:

| ID | Settled value |
|---|---|
| FR-PRACTICE-04 | right→5 / wrong→2 |
| FR-PRACTICE-06 | 60 min idle |
| FR-WORD-10 | ≥5,000 headwords; arch must scale to ~50 languages |
| FR-AUTH-05 / Appendix A | Default list + admin synonyms + external profanity blocklist |
| FR-SAVE-08 | 30 s idempotency window |
| FR-SAVE-09 | `audio_listen` priority = Must |
| FR-AUTH-18 | ms-precision timestamps; latest wins (no anon-vs-registered tiebreaker) |
| NFR-PRIV-02 | 2 years anon-profile dormancy purge |
| NFR-OPS-01 | Daily×30 + weekly×26; RPO ≤24h |
| NFR-OPS-04 | 90 days at launch → 30 days when stable |
| NFR-SEC-02 | 4-step HSTS ramp tied to stability milestones, not calendar |
| NFR-PERF-04 | 200ms cached / 400ms uncached p95 at origin |
| NFR-PERF-05 | 50ms p95 DB |
| NFR-PERF-07 | 150KB / 200KB page weight ex. audio+fonts |
| NFR-PERF-08 | 200 anon + 20 practicing × 10 min load test |
| NFR-OPS-06 | Best-effort, 99% aspiration, no SLA |

### 3.2 Foundational Decisions are not negotiable in this phase.

If a question seems to challenge a Round 1 foundational decision (e.g., "should we drop bcrypt for argon2?"), don't re-open that decision in this chat. Acknowledge the question, point at where the decision was made and why, and confirm whether the maintainer wants to formally revisit it (which would happen in a separate chat, not via casual reopening).

### 3.3 Round 4 drafting is the next deliverable, but not in this chat.

This chat is for **reading and Q&A**. The merged SRS v1.0 will be produced in a *fresh* chat after this one, using the same set of files plus any wording fixes that emerge from this chat's discussion. If the maintainer says "let's fix this wording," capture the change as a copy-paste find-and-replace edit so it can be applied to R2 or R3 directly, or carried into the Round 4 merge. **Do not produce the merged SRS v1.0 in this chat.**

### 3.4 Out-of-scope topics for this chat.

The chat after this one is the merge. The chat after *that* is the SDD. Don't drift forward into design territory. If the maintainer asks an SDD-level question while reading R2/R3 (e.g., "which library do we use for IPA rendering?"), answer briefly and flag that it's an SDD question to be settled later, not a v1.0 SRS question.

### 3.5 Style for explanations.

The previous chat established a working style for explaining unfamiliar topics: layered, with concrete reference points and tables. Continue this. The maintainer will tell you if you're going too deep or too shallow. He's not afraid to say "explain more" — that's a normal part of the workflow, not a failure signal.

---

## 4. Locked architectural facts (carry forward verbatim if asked)

These are settled and should be treated as ground truth in any answer:

- **License:** AGPL-3.0 code, CC BY-SA 4.0 content.
- **v1.0 language variant:** American English (`en-us`) only.
- **URL pattern:** `pronounceall.com/:variant/:word`.
- **Rendering:** EJS server-side, raw CSS, vanilla JS for progressive enhancement. No React.
- **DB:** MySQL.
- **Stack:** Node.js + Express + MySQL + Docker + Hetzner VPS + Cloudflare + Nginx + Certbot + dotenv + GitHub Actions CI.
- **Audio fallback chain:** Wiktionary human → AI TTS (pre-batched) → Web Speech API.
- **Practice algorithm:** SM-2, self-assessment only, no microphone/ML in v1.0.
- **Save model:** append-only event log + derived state tables. "Latest event wins per target" merge rule.
- **Cookie model:** anonymous UUID cookie is strictly necessary, acknowledgment-only (no consent screen) under GDPR/KVKK. Backed up to `localStorage` for self-healing. Sliding 2-year `Max-Age`.
- **Registration paths:** Google OAuth, email+password, username+optional-email. All require unique username chosen at signup.
- **Deletion:** soft delete (30-day grace, default) or hard delete (immediate, irreversible). Re-auth required.
- **Bot protection:** Cloudflare Turnstile on `/register`, `/login`, `/reset-password`, `/request-word`.
- **Rate limits:** per Foundational Decisions §10.3, Redis store in production.
- **Ads:** off by default, opt-in toggle in Settings (UI present in v1.0; no ad network wired up).
- **Open-source banner:** dismissable via `localStorage`, reappears after 30 minutes.
- **Iteration plan:** 0 (foundation) → 1 (word pages) → 2 (IPA system) → 3 (save/tag) → 4 (auth) → 5 (practice) → 6 (settings) → 7 (hardening). Each fully done before the next.

---

## 5. Structure of R2 (so the next chat can navigate quickly)

Round 2 SRS (`PronounceAll_SRS.md`) contains:
- §1 Introduction
- §2 Overall description
- §3 Requirements conventions (FR style: shall + MoSCoW + rationale + acceptance criteria)
- §4 Functional Requirements, organized into 9 areas:
  - 4.1 WORD — word page rendering, fuzzy matching, 404, word requests
  - 4.2 IPA — clickable phonemes, popovers, /learnIPA, progress banner
  - 4.3 SAVE — three-state save (saved/learning/learned), event log, derived state
  - 4.4 PRACTICE — saved-words session, SM-2, self-assessment, reinsertion
  - 4.5 AUTH — three registration paths, sessions, merge logic, deletion
  - 4.6 CONSENT — strictly-necessary cookie acknowledgment, KVKK/GDPR notice
  - 4.7 OSS — open-source banner, license display
  - 4.8 SET — settings page (account, cookies, ads, language, logout)
  - 4.9 CONTENT — seeding, content sources, attribution

## 6. Structure of R3

Round 3 SRS (`PronounceAll_SRS_Round3.md`) contains:
- §5 Non-Functional Requirements, organized into 8 categories:
  - 5.1 SEC — TLS, HSTS, CSP, headers, password storage, session security
  - 5.2 PERF — Core Web Vitals, TTFB, DB budgets, page weight, load test
  - 5.3 A11Y — WCAG 2.1 AA, axe-core zero violations, keyboard nav
  - 5.4 PRIV — data minimization, retention, anonymous profile lifecycle
  - 5.5 OPS — backups, log retention, monitoring, availability commitment
  - 5.6 COMPAT — browser support, mobile-first, progressive enhancement
  - 5.7 I18N — English UI, Turkish legal pages only for v1.0
  - 5.8 LEGAL — GDPR/KVKK obligations, AGPL/CC BY-SA compliance
- §6 Traceability matrix mapping NFRs back to Charter Success Criteria and threat model entries (TM still pending; placeholder annotations stay until TM document is written)
- §7 Appendices

---

## 7. Things the maintainer is likely to ask about

Best guesses based on what was harder to explain in the last chat:

- **Anything in §5.1 SEC** — HSTS, CSP nonces, SRI, cookie flags, bcrypt cost factor. He has been honest that he doesn't fully know Cloudflare/TLS/Certbot mechanics.
- **§5.2 PERF budgets** — what TTFB/p95/INP actually mean and how they're measured.
- **§4.5 AUTH merge logic** — the anonymous-to-registered merge has subtle rules and may need walking through.
- **§4.3 SAVE event log + derived state** — append-only design, idempotency, the "latest wins" rule.
- **§4.4 PRACTICE SM-2** — how the algorithm actually works.
- **§5.4 PRIV anonymous profile lifecycle** — interaction between cookie `Max-Age` and dormancy retention.
- **Traceability matrix** — what the "—" entries and "TM pending" annotations mean.

He is unlikely to ask about: the licensing statement, the URL pattern, the iteration order, anything that's been said five times already.

---

## 8. The instruction line for the next chat

The maintainer should open the next chat with something like:

> "Uploaded: Charter, Handoff Document, Foundational Decisions, Round 2 SRS, Round 3 SRS, Round 4 Handoff, Round 4 Decisions, and this Reading & Q&A Handoff. I'm reading R2 and R3 and will ask questions. Don't merge anything yet — that's the next chat. Don't drift into SDD topics. When I ask about a requirement that has a placeholder in R2 or R3, give me the value from the Round 4 Decisions Document, not the placeholder."

That single instruction, plus this handoff, gives the next Claude full context.

---

*End of Reading & Q&A handoff. The next chat is for clarifying-question Q&A only. The chat after that is the Round 4 merge → SRS v1.0.*
