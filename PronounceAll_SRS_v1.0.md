# PronounceAll — Software Requirements Specification

**Version:** 1.0.1
**Status:** Approved (pending maintainer sign-off)
**Owner:** Alp K. (solo developer)
**Domain:** pronounceall.com
**Scope of this document:** v1.0 release (American English only)
**Derived from:** Project Charter v1.0, Project Handoff Document v1.0 (Feature Brief v0.1 Locked), SRS Foundational Decisions (Round 1), SRS Round 4 Decisions.

---

## Document history

| Version | Description |
|---------|-------------|
| 0.1 | Round 1 — foundational decisions captured in the separate *SRS Foundational Decisions* document. |
| 0.2 | Round 2 draft — §1–§3 and all functional requirements (§4). |
| 0.3 | Round 3 draft — §5 non-functional requirements, §6 traceability matrix, §7 appendices. |
| 1.0 | Merge of Rounds 2 and 3, with Round 4 maintainer decisions applied. |
| 1.0.1 | SDD Round 1 reconciliation amendments applied; no v1.0 product scope change. |

---

## Table of contents

1. **Introduction**
   - 1.1 Purpose
   - 1.2 Scope
   - 1.3 Definitions, acronyms, abbreviations
   - 1.4 References
   - 1.5 Document overview
2. **Overall description**
   - 2.1 Product perspective
   - 2.2 Product functions (summary)
   - 2.3 User classes and characteristics
   - 2.4 Operating environment
   - 2.5 Design and implementation constraints
   - 2.6 Assumptions and dependencies
3. **Requirements conventions**
   - 3.1 Requirement identifiers
   - 3.2 Priority (MoSCoW)
   - 3.3 Statement style (hybrid)
   - 3.4 Testability
   - 3.5 Traceability
   - 3.6 Out-of-scope markers
4. **Functional requirements**
   - 4.1 Word pages — `FR-WORD-*`
   - 4.2 IPA system — `FR-IPA-*`
   - 4.3 Save & tag system — `FR-SAVE-*`
   - 4.4 Practice sessions — `FR-PRACTICE-*`
   - 4.5 Authentication & account lifecycle — `FR-AUTH-*`
   - 4.6 Consent, cookies & legal — `FR-CONSENT-*`
   - 4.7 Open-source banner — `FR-OSS-*`
   - 4.8 Settings — `FR-SET-*`
   - 4.9 Content & data seeding — `FR-CONTENT-*`
5. **Non-functional requirements**
   - 5.1 Security — `NFR-SEC-*`
   - 5.2 Performance — `NFR-PERF-*`
   - 5.3 Accessibility — `NFR-A11Y-*`
   - 5.4 Privacy — `NFR-PRIV-*`
   - 5.5 Operations — `NFR-OPS-*`
   - 5.6 Compatibility — `NFR-COMPAT-*`
   - 5.7 Internationalisation — `NFR-I18N-*`
   - 5.8 Legal & licensing — `NFR-LEGAL-*`
6. **Traceability matrix**
   - 6.1 Word pages · 6.2 IPA system · 6.3 Save & tag · 6.4 Practice · 6.5 Authentication · 6.6 Consent · 6.7 Open-source banner · 6.8 Settings · 6.9 Content · 6.10 Non-functional requirements
7. **Appendices**
   - Appendix A — Reserved usernames
   - Appendix B — Phoneme example-word list
   - Appendix C — Rate-limit quick reference
   - Appendix D — Cookie inventory (launch baseline)
   - Appendix E — PII field inventory
   - Appendix F — Endpoint catalogue quick reference

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) defines the complete, numbered, testable set of functional and non-functional requirements for PronounceAll v1.0. It is the authoritative hand-off between the requirements phase and the design phase (SDD, ERD, API Specification, Threat Model). Every requirement has a stable identifier and is phrased so that a downstream test case can verify it.

This SRS is a living document under the change-control rules in Charter §10: any change in scope, licensing, or target platform must be reflected here and in the Handoff simultaneously.

### 1.2 Scope

PronounceAll is an open-source web application that teaches English pronunciation through the International Phonetic Alphabet (IPA). v1.0 is intentionally narrow: American English only (`en-us`), self-assessment practice only (no microphone or ML), no native mobile apps, no ads wired to a network. The product is free of charge, free of non-essential tracking, and free (as in freedom) under AGPL-3.0 for code and CC BY-SA 4.0 for content.

What v1.0 does: serves per-word pages with meaning, clickable IPA, whole-word audio, and syllable/stress breakdowns; teaches the ~44 English phonemes on a dedicated page; lets anonymous visitors save and tag words and phonemes; runs SM-2 spaced-repetition practice sessions; supports three registration paths (Google OAuth, email+password, username±email); merges anonymous progress into registered accounts deterministically; honours GDPR/KVKK with explicit right-to-erasure.

What v1.0 does not do: any language other than American English; microphone-based pronunciation grading; IPA-subset practice (pronounce-me-a-word-using-these-phonemes); community-contributed audio; dark mode; user-facing analytics. These are catalogued in Charter §6 and the Handoff's post-v1.0 section.

### 1.3 Definitions, acronyms, abbreviations

| Term | Meaning |
|------|---------|
| **IPA** | International Phonetic Alphabet — the per-sound notation used on every word page. |
| **Phoneme** | A single distinctive sound, represented by one IPA symbol or symbol cluster (e.g. `/θ/`, `/eɪ/`). |
| **Variant** | A language/region pair treated as a standalone language for pronunciation purposes, e.g. `en-us`, `en-gb`. v1.0 ships `en-us` only. |
| **Anonymous profile** | The server-side row keyed to the visitor's UUID cookie; stores progress for users who have not registered. |
| **Registered account** | A permanent account created via one of the three registration paths. |
| **SM-2** | The spaced-repetition scheduling algorithm used by Anki (and many similar tools); selected in Handoff. |
| **Event log** | Append-only `user_activity_events` table recording every save, tag change, and practice attempt. | <!-- Records every action, never deletes -->
| **Derived state** | Per-target snapshot tables (`user_word_states`, `user_phoneme_states`, `sm2_states`) computed from the event log. <!-- Answers "What's the users's current tag for word: blabla" --> |
| **Three-state save** | The values a saved target can hold: `saved` (untagged), `learning`, `learned`. |
| **Turnstile** | Cloudflare's privacy-respecting bot-challenge widget (see Foundational Decisions §9). <!-- it tries to distinguish a real browser from an automated script, without showing the user a puzzle and without tracking them across the web. -->|
| **HIBP** | Have I Been Pwned — the k-anonymity password-compromise check used during password choice. |
| **CWV** | Core Web Vitals (LCP, CLS, INP). <!-- Google's standarts for pages, for CLS ensure that every UI element has an prearranged space --> |
| **AGPL-3.0** | GNU Affero General Public License v3.0; the code license. <!--Anyone can read, modify, and redistribute the code, but any modified version they distribute must also be released under GPL with source code.   --> |
| **CC BY-SA 4.0** | Creative Commons Attribution-ShareAlike 4.0 International; the content license. <!-- Same philosophy as AGPL but for content, anything that isn't source code --> |
| **KVKK** | *Kişisel Verilerin Korunması Kanunu* — Turkey's personal-data protection law. |
| **GDPR** | EU General Data Protection Regulation 2016/679. |
| **ASVS** | OWASP Application Security Verification Standard, v5.0.0 (target: Level 2; long-term pin per Foundational Decisions §2). |<!-- "Be designed against likely attacks" --> 

### 1.4 References

- Project Charter v1.0.
- Project Handoff Document v1.0 (Feature Brief v0.1, Locked).
- SRS Foundational Decisions (Round 1).
- OWASP ASVS v5.0.0, Level 2 (long-term pin per Foundational Decisions §2).
- NIST SP 800-63B Rev 3 (password guidance; long-term pin per Foundational Decisions §2).
- GDPR, Articles 6, 7, 13, 17.
- KVKK, Articles 5, 10, 11.
- WCAG 2.2, Level AA (also published as ISO/IEC 40500:2025).
- SM-2 algorithm (Woźniak, 1990).
- Unicode IPA Extensions block (U+0250–U+02AF) and Spacing Modifier Letters block (U+02B0–U+02FF), the latter providing the stress marks ˈ (U+02C8) and ˌ (U+02CC) used in syllable/stress display.
- Wiktionary API and dump licence (CC BY-SA 4.0).

### 1.5 Document overview

Section 2 gives the product perspective, user classes, operating environment, and design constraints. Section 3 states the conventions used for requirement IDs, priorities, rationale, and acceptance criteria. Section 4 enumerates every functional requirement, grouped by feature area and using the hybrid style defined in Foundational Decisions §1. NFRs, the traceability matrix, and appendices follow in Round 3.

---

## 2. Overall description

### 2.1 Product perspective

PronounceAll is a self-contained, server-rendered web application. It is not a plugin, not a mobile app, and not a client of a proprietary backend. The production deployment is a single Hetzner VPS running Docker Compose with three containers: Node.js + Express (application), MySQL 8 (database), and Nginx (reverse proxy + static assets), sitting behind Cloudflare for TLS termination, caching, and edge rate-limiting. Redis is added for the rate-limit store and session cache. Certbot provisions the origin certificate used between Cloudflare and the VPS.

External dependencies at runtime are deliberately few:

- **Google OAuth 2.0** — one of three registration paths.
- **Cloudflare Turnstile** — bot protection on four write endpoints.
- **A transactional-email provider** (Brevo / Resend / SMTP2GO — final choice deferred to SDD) — for email verification, password reset, deletion confirmation.
- **Have I Been Pwned range API** — k-anonymity password check during password choice.
- **Cloudflare edge** — DNS, TLS, CDN, WAF.

No analytics provider, no advertising network, no CRM, no feature-flag service. The product is intentionally small-surface.

Content comes from open sources: Wiktionary for dictionary entries and, where available, human audio recordings; a pre-generated TTS batch for words lacking human audio; one-time outsourced phoneme recordings replaced over time by the maintainer's own. Dictionary licensing terms (CC BY-SA 4.0 for Wiktionary) are preserved and attributed.

### 2.2 Product functions (summary)

A more precise catalogue appears in §4. At a glance, v1.0 provides:

- Per-word pages at `/:variant/:word` with meaning, clickable IPA, whole-word audio, syllable/stress breakdown.
- A friendly 404 page with fuzzy-match suggestions and a word-request form.
- A per-language `/:variant/learnIPA` page covering the variant's phonemes (~44 for `en-us`) in frequency order, and a global `/learnIPA` page listing every phoneme across every variant; in v1.0 they render identical content because `en-us` is the only seeded variant.
- A three-state save system for both words and phonemes.
- SM-2 practice sessions driven by the user's saved items.
- Three registration paths plus anonymous use, with deterministic merge on login.
- A Settings page covering account management, cookie preferences, ad opt-in, language selector, logout, and full right-to-erasure.
- Legal surface: cookie acknowledgement banner, privacy policy (EN + TR), KVKK *Aydınlatma Metni*.
- Open-source banner (30-minute dismissal via `localStorage`).

### 2.3 User classes and characteristics

| Class | Description | Relative frequency | Technical expertise | Privilege level |
|-------|-------------|--------------------|---------------------|-----------------|
| **Anonymous visitor** | First-time or not-yet-registered users browsing word pages and possibly saving items under a UUID cookie. | Highest (expected majority of traffic). | Any. Must have cookies enabled to save progress; read-only otherwise. | Public + own UUID scope. |
| **Registered user** | A visitor who completed one of three registration paths. | Smaller than anonymous but higher-engagement. | Any. | Public + own account scope. |
| **Maintainer / operator** | Alp K. and any future co-maintainers. | One person for v1.0. | Senior developer. | Full system access via SSH/DB; no in-app admin UI in v1.0. |
| **External service** | Google OAuth, Cloudflare Turnstile, transactional email provider, HIBP, Wiktionary, TTS provider. | Ambient. | N/A. | Scoped tokens / API keys. |
| **Open-source contributor** | Outside developers filing issues or PRs. | Expected to be small at launch. | Variable. | Read-only via GitHub; no runtime system access. |

v1.0 has no in-app administrator role. All content and schema changes happen via deploys. A proper admin UI is a post-v1.0 concern.

### 2.4 Operating environment

**Server-side:**

- Ubuntu LTS (22.04 or 24.04) on a Hetzner VPS.
- Docker Engine + Docker Compose.
- Node.js LTS (≥ 20.x).
- MySQL 8.
- Redis 7 (rate-limit store, session cache).
- Nginx 1.24+ as reverse proxy and static-file server.
- Cloudflare in front (DNS, TLS, WAF, CDN).

**Client-side:**

- Browsers: 2022+ evergreen Chrome, Firefox, Safari, Edge (Foundational Decisions §5).
- Word pages must render and be navigable without JavaScript (progressive enhancement).
- Interactive features (IPA click-to-play, save popover, practice session) require JavaScript on the 2022+ baseline.
- Cookies and `localStorage` required for progress tracking; graceful read-only degradation if unavailable.

### 2.5 Design and implementation constraints

- **Stack is frozen for v1.0** (see Charter + Handoff): Node.js + Express + EJS, raw CSS, vanilla JS, MySQL, Docker, Nginx, Cloudflare. No React, no SPA, no serverless.
- **Licensing is frozen:** AGPL-3.0 for code, CC BY-SA 4.0 for content, Wiktionary upstream terms preserved.
- **Security standard:** OWASP ASVS v5.0.0, Level 2 (long-term pin per Foundational Decisions §2); every control documented inline with the requirement it enforces.
- **Legal baseline:** GDPR-first, KVKK satisfied as a side-effect; Turkish translation only of the two legal notices.
- **Layout primitive:** Flexbox-first; CSS Grid only where Flex would require harmful nesting.
- **No non-essential cookies by default** (Charter §4, item 6).
- **Open-source from day one:** the public repo must exist at Iteration 0, not after launch.
- **Single maintainer:** every feature must be operable by one person on call.

### 2.6 Assumptions and dependencies

- Google OAuth remains free and stable.
- Cloudflare Turnstile remains free for the expected traffic volume.
- Wiktionary remains freely available; dumps are retrievable; licence stays CC BY-SA.
- A TTS provider (Google Cloud, Azure, or AWS Polly) continues to offer a free tier large enough to generate audio for the seeded dictionary (~tens of thousands of words) and for occasional re-runs.
- The chosen transactional-email provider honours its free tier for the expected volume.
- HIBP's range API remains free and does not rate-limit legitimate verification traffic.
- Node.js LTS releases continue on schedule.

If any of these assumptions breaks, the affected feature's behaviour is covered by a fallback requirement in §4 (e.g. audio fallback chain, Turnstile visible-challenge fallback) or by a risk in the Risk Register.

---

## 3. Requirements conventions

### 3.1 Requirement identifiers

Every requirement has a stable ID of the form `FR-<AREA>-<NN>` or `NFR-<AREA>-<NN>`, where:

- `FR` = functional requirement; `NFR` = non-functional (Round 3).
- `<AREA>` is one of: `WORD`, `IPA`, `SAVE`, `PRACTICE`, `AUTH`, `CONSENT`, `OSS`, `SET`, `CONTENT` (functional); `SEC`, `PERF`, `A11Y`, `PRIV`, `OPS`, `I18N`, `COMPAT`, `LEGAL` (non-functional).
- `<NN>` is a two-digit zero-padded sequence, assigned in drafting order.

IDs are **stable**: once assigned, an ID is never reused even if the requirement is retired. Retired requirements remain in the document marked `[RETIRED]` with a pointer to the replacement.

### 3.2 Priority (MoSCoW)

Each requirement carries a MoSCoW priority:

- **Must** — v1.0 cannot launch without it. Failure blocks the Charter success criteria.
- **Should** — strongly desired for v1.0 but a single clearly-scoped Should item may slip to the next patch without blocking launch; slippage is a Risk Register entry.
- **Could** — nice to have in v1.0; first to be cut under time pressure.
- **Won't (this release)** — in scope for the project but explicitly deferred past v1.0. Listed for visibility but without an acceptance-criteria block.

### 3.3 Statement style (hybrid)

Every requirement is written as:

> **FR-XXX-NN — Short title.** *Priority: Must/Should/Could.*
>
> **Shall-statement.** The system shall ⟨verb⟩ ⟨object⟩ ⟨constraints⟩.
>
> **Rationale** *(included when the reason is non-obvious)*: one or two sentences.
>
> **Acceptance criteria** *(included on non-trivial FRs)*:
> - Bullet list of black-box verifiable conditions, each testable with a Jest, Supertest, Playwright, axe-core, or manual test case.

Trivial FRs (one-line behaviours with obvious rationale) drop the rationale and acceptance-criteria blocks.

### 3.4 Testability

Every requirement is phrased so that a tester can answer "is this satisfied?" with yes or no, given the running system. Statements such as "the system shall be fast" are not acceptable; numeric thresholds, observable states, or defined responses are required. Performance targets and similar numeric NFRs are concentrated in the NFR section (Round 3) and referenced from FRs rather than duplicated.

### 3.5 Traceability

Each requirement will be cross-referenced in the traceability matrix (Round 3) against:

- the Charter success criterion it supports,
- the Handoff decision that drove it,
- the downstream test case ID,
- the threat model entry (for security-sensitive FRs).

### 3.6 Out-of-scope markers

A requirement marked `[OUT-OF-SCOPE for v1.0]` captures a deliberate deferral and is listed only to prevent a future reader from assuming it was forgotten. It has a priority of **Won't** and no acceptance criteria.

---

## 4. Functional requirements

### 4.1 Word pages — `FR-WORD-*`

#### FR-WORD-01 — URL pattern and variant routing. *Priority: Must.*

The system shall serve every word page at the URL pattern `https://pronounceall.com/:variant/:word`, where `:variant` is a registered language-variant code and `:word` is the normalised word slug. For v1.0 the only registered variant is `en-us`.

**Rationale:** Handoff and Charter fix this URL shape so future variants (`en-gb`, `fr-fr`, etc.) slot in without breaking links or changing the information architecture.

**Acceptance criteria:**
- `GET /en-us/cupcake` returns HTTP 200 with the cupcake word page when `cupcake` is in the dictionary.
- `GET /fr-fr/cupcake` returns HTTP 404 with an "unsupported variant" message in v1.0, not the `en-us` page.
- `GET /en-us/` (trailing slash, no word) redirects to the home page; it never returns a random word.
- The variant component is validated against the `language_variants` table before the word lookup runs.

#### FR-WORD-02 — Word slug normalisation. *Priority: Must.*

The system shall normalise the `:word` path segment before lookup by: lower-casing, Unicode-NFC-normalising, trimming surrounding whitespace, rejecting any slug containing characters outside the allow-list defined per variant. For `en-us` the allow-list is `[a-z]` plus hyphen and apostrophe (for words like `mother-in-law`, `don't`). If the input differs from the canonical form, the system shall 301-redirect to the canonical URL rather than rendering on the denormalised URL.

**Rationale:** Canonicalisation avoids duplicate-content SEO penalties, prevents cache fragmentation, and blocks a class of attacks that smuggle control characters through URL parameters.

**Acceptance criteria:**
- `GET /en-us/Cupcake` returns HTTP 301 to `/en-us/cupcake`.
- `GET /en-us/  cupcake  ` (URL-encoded spaces) returns HTTP 301 to `/en-us/cupcake`.
- `GET /en-us/cup%00cake` (null byte) returns HTTP 400.
- `GET /en-us/don%27t` renders the entry for `don't`.

#### FR-WORD-03 — Word page content. *Priority: Must.*

The system shall render, for every word present in the dictionary for the requested variant, a page containing at minimum: the word itself as the page heading; its meaning(s) sourced from the dictionary; one or more IPA transcriptions drawn from `word_pronunciations`, presented in `display_order` with the `is_primary` pronunciation leading and any further pronunciations shown as secondary entries, each transcription's phonemes rendered as clickable elements (see §4.2); a whole-word audio control; and a written syllable/stress breakdown. Exactly one pronunciation per word carries `is_primary`, and both `is_primary` and `display_order` are populated and validated at ingestion. The whole-word audio presentation for secondary pronunciations is a design decision deferred to the SDD and is not fixed here.

**Acceptance criteria:**
- Every field listed above is present in the rendered HTML for `GET /en-us/cupcake` and any other seeded word.
- The IPA transcription's phoneme elements each expose a stable data attribute (`data-phoneme-id`) keyed to a row in `phonemes`.
- A word with more than one pronunciation (for example a heteronym such as `lead`) renders each pronunciation from `word_pronunciations` in `display_order`, with exactly one marked `is_primary`; seed validation rejects any word that lacks a single primary pronunciation.
- The syllable/stress breakdown identifies primary stress and, where applicable, secondary stress using the standard IPA markers `ˈ` and `ˌ`.
- Meaning(s) are attributed to the upstream dictionary source in a visible footer on the word page.

#### FR-WORD-04 — Unknown-word page with fuzzy suggestions. *Priority: Must.*

When a request is made to `/:variant/:word` and `:word` does not exist in the dictionary for that variant, the system shall return HTTP 404 with a dedicated page that: (a) states the word is not yet in the dictionary; (b) shows up to five fuzzy-match suggestions that cover both typographical errors (including adjacent-character transpositions such as `freind` for `friend`) and phonetic misspellings (spelling a word roughly as it sounds), ranked by closeness then by frequency; the exact matching algorithm is specified in the SDD; (c) offers a word-request control (see FR-WORD-05).

**Rationale:** Making 404s helpful converts typos into successful lookups and channels genuine gaps into the word-request backlog.

**Acceptance criteria:**
- `GET /en-us/cuppcake` returns HTTP 404 and displays `cupcake` among its suggestions.
- `GET /en-us/xqzzy` returns HTTP 404, shows no suggestions (no sufficiently close match), and still offers the word-request control.
- Response status is genuinely 404 (not 200), to keep search engines from indexing the page as a real entry.

#### FR-WORD-05 — Word-request capture. *Priority: Must.*

The system shall allow any visitor to request that a missing word be added to the dictionary, via a form on the 404 page. The form captures only the variant and the requested word; no personal data. Submissions are rate-limited per §10.3 of Foundational Decisions (10 per hour per UUID cookie) and gated by Cloudflare Turnstile.

**Acceptance criteria:**
- Submitting the form from the 404 page for `xqzzy` creates a row in `word_requests` with `variant = 'en-us'`, `word = 'xqzzy'`, the submitter's anonymous UUID or user ID, and a timestamp.
- An 11th submission within a rolling hour from the same UUID returns HTTP 429 with a `Retry-After` header.
- Submissions without a valid Turnstile token are rejected with HTTP 400.
- Duplicate submissions (same variant + word) from different users increment an up-vote-style counter rather than creating duplicate rows.

#### FR-WORD-06 — Progress-aware IPA banner. *Priority: Must.*

Every word page shall display a prominent banner linking to `/:variant/learnIPA` for the page's active variant. The banner's text shall reflect the viewer's progress: for users with zero phonemes in `learned` state it shall read a fixed invitation ("Learn every sound in English! Just learn these N IPA symbols to pronounce every word"); for users with at least one phoneme in `learned` it shall read a progress form ("M/N — doing great! K to go"), where M is the count of phonemes the user has tagged `learned` for the active variant, N is the total count of phonemes in the `phonemes` table for the active variant, and K is N − M.

**Rationale:** Charter Success Criterion 1 and the Handoff explicitly require the banner to be progress-aware and to pull N dynamically rather than hard-coding 44.

**Acceptance criteria:**
- For an anonymous visitor who has never saved a phoneme, the banner's N equals `SELECT COUNT(*) FROM phonemes WHERE variant = '<active variant>'` (e.g. `'en-us'` on a `/en-us/:word` page).
- After the visitor tags one phoneme as `learning` (but none as `learned`), the banner continues to display the invitation form, not the progress form.
- After the visitor tags one phoneme as `learned`, the banner re-renders on the next word-page load as `1/N — doing great! N-1 to go`.
- The banner is present on every word page (not only on pages where the visitor is logged in).
- Clicking the banner navigates to `/:variant/learnIPA` for the active variant of the page (e.g. `/en-us/learnIPA` from `/en-us/cupcake`).

#### FR-WORD-07 — Responsive layout. *Priority: Must.*

Word pages shall render usably on viewport widths from 320 px to 1920 px. On viewports below 640 px the page shall use a single-column stacked layout; above 640 px a comfortable two-column layout is permitted. No horizontal scrolling shall be required at any supported width.

**Acceptance criteria:**
- Playwright tests at 320, 375, 768, 1024, and 1440 px confirm no horizontal scrollbar on `/en-us/cupcake`.
- All interactive controls remain tappable (≥ 44×44 CSS px target) at 320 px.
- Text never clips or overflows its container at any tested width.

#### FR-WORD-08 — Graceful degradation without JavaScript. *Priority: Must.*

The word page shall render the word, its meaning, the IPA transcription (as static text), and the syllable/stress breakdown correctly with JavaScript disabled. Click-to-play audio, save popover, and the progress banner's live count are allowed to degrade in defined ways (see FR-IPA-05, FR-SAVE-07).

**Rationale:** Foundational Decisions §5 mandates progressive enhancement for reading even though interactive features require JS.

**Acceptance criteria:**
- With JS disabled in the Playwright test, `GET /en-us/cupcake` still shows word, meaning, IPA string, and syllable/stress.
- The whole-word audio control, when JS is disabled, falls back to an `<audio controls>` element that the browser can play natively.
- The IPA phoneme elements remain visible as text; they simply do not respond to clicks.

#### FR-WORD-09 — Canonical tag and SEO basics. *Priority: Should.*

Every word page shall include a `<link rel="canonical">` tag pointing at the canonical URL (post-normalisation), a meaningful `<title>` of the form `"⟨word⟩ — American English pronunciation · PronounceAll"`, and a `<meta name="description">` containing the word's primary meaning truncated to ≤ 160 characters.

**Rationale:** Cheap, standards-based SEO; also contributes to Charter Success Criterion 4 (Lighthouse SEO ≥ 90).

#### FR-WORD-10 — Seeded dictionary coverage at launch. *Priority: Must.*

At v1.0 launch the `words` table shall contain at least 5 000 common American-English headwords, each with meaning, IPA transcription, and a valid audio source (human, pre-generated TTS, or Web Speech API fallback-enabled).

**Rationale:** A tiny dictionary defeats the Charter's vision. 5 000 headwords is enough for demonstrable utility while remaining within TTS free-tier and QA budgets. The variant infrastructure — the `:variant/:word` URL pattern and the `language_variants` table — must be structured to scale to roughly 50 language variants and each variant's full headword count, so that adding a variant is a data-and-content-batch exercise rather than a code change.

**Acceptance criteria:**
- `SELECT COUNT(*) FROM words WHERE variant = 'en-us'` ≥ 5 000 on the launch database.
- For every seeded word, `word_pronunciations` has at least one IPA entry and `audio_assets` has at least one playable asset or a confirmed Web-Speech-API fallback configuration.

### 4.2 IPA system — `FR-IPA-*`

#### FR-IPA-01 — Phoneme table coverage. *Priority: Must.*

The `phonemes` table shall contain one row for each distinct phoneme of the PronounceAll en-us Phoneme Inventory (41 symbols: 24 consonants, 10 monophthong vowels, 5 diphthongs, 2 r colored vowels), documented in the SDD with its transcription convention. Each row shall include: the IPA symbol (NFC-normalised), a stable internal ID, a frequency rank, at least one example word, and a reference to an audio asset.

**Acceptance criteria:**
- `SELECT COUNT(*) FROM phonemes WHERE variant = 'en-us'` returns exactly 41, per the canonical inventory documented in the SDD.
- Every row has a non-null `audio_asset_id` and a non-null `primary_example_word_id`.
- The frequency rank is dense and unique (1…N) within each variant, enabling deterministic ordering on `/:variant/learnIPA`.

#### FR-IPA-02 — Clickable phoneme elements on word pages. *Priority: Must.*

On every word page the IPA transcription shall be rendered as a sequence of clickable elements, one per phoneme, each bearing `data-phoneme-id` and keyboard focusability. Clicking or pressing Enter/Space on a phoneme element shall: (a) play the single-phoneme audio, and (b) open a popover anchored to the element.

**Rationale:** This is the central pedagogical interaction of the site.

**Acceptance criteria:**
- The `/en-us/cupcake` page contains exactly one clickable element per phoneme in the word's transcription.
- Each element has a role, an accessible name (`aria-label` = "phoneme /k/", etc.), and is reachable via the tab sequence.
- Clicking a phoneme fires the audio (see FR-IPA-04) and opens the popover (see FR-IPA-03).

#### FR-IPA-03 — Phoneme popover content. *Priority: Must.*

The popover opened by a phoneme click shall contain: the IPA symbol, a replay button for the phoneme audio, one popular example word that genuinely contains the target sound (matched by sound, not by spelling), and a control to save/tag the phoneme. Where the phoneme can occur word-initially and that is pedagogically useful, a word-initial example is preferred; for phonemes that do not occur word-initially (for example `/ŋ/` or `/ʒ/`), an example demonstrating the sound in any position is used.

**Rationale:** Teaches by example, avoids the spelling-vs-sound trap (e.g. for `/k/` the example should be `cat`, not a K-initial word like `knife`).

**Acceptance criteria:**
- For `/k/`, the example word is matched by `phoneme_example_words.match_mode = 'sound'` and its phonemic transcription contains `/k/` (a word-initial example such as `cat` is preferred where the phoneme permits it).
- Pressing the replay button replays the phoneme audio without re-opening the popover.
- The save control inside the popover reuses the component defined in §4.3 and operates on the phoneme target.
- The popover is dismissable by Esc, outside click, and an explicit close button.

#### FR-IPA-04 — Phoneme audio playback latency. *Priority: Must.*

From the moment a phoneme element receives a click until audio begins, elapsed time shall not exceed 150 ms on the 2022+ evergreen baseline over a 4G connection with phoneme audio preloaded (see FR-IPA-06).

**Rationale:** Instant feedback is pedagogically critical; laggy audio breaks the mental link between click and sound.

**Acceptance criteria:**
- Instrumented measurement in a Playwright test with Lighthouse throttling confirms < 150 ms median and < 250 ms p95 across 50 clicks on `/en-us/cupcake`.

#### FR-IPA-05 — Whole-word audio with fallback chain. *Priority: Must.*

Every word page shall present a whole-word audio control. When activated, the system shall attempt audio sources in the following order, using the first that succeeds: (1) a Wiktionary human recording if available and cached server-side; (2) pre-generated TTS audio stored server-side; (3) the browser's Web Speech API invoked client-side with the word's phonetic form. If all three fail, the control shall display a user-visible error and no silent failure.

**Rationale:** Human audio is preferred pedagogically; TTS fills gaps; Web Speech API is the last-resort client-side fallback that requires no server audio.

**Acceptance criteria:**
- For a seeded word with a Wiktionary recording, the served audio is that recording.
- For a seeded word without a Wiktionary recording but with pre-generated TTS, the served audio is the TTS asset.
- Disabling both server-side sources in an integration test produces a page where activating the control invokes `window.speechSynthesis.speak`.
- Disabling all three produces a visible "Audio unavailable" indicator.

#### FR-IPA-06 — Audio preload and lazy-load strategy. *Priority: Should.*

Word pages shall preload the phoneme audio files corresponding to the phonemes present in the word (typically 3–10 files). Both the per-language `/:variant/learnIPA` page and the global `/learnIPA` page shall not preload phoneme audio; instead they shall lazy-load each file on demand.

**Rationale:** Foundational Decisions §4. Preloading the full phoneme set on either `/:variant/learnIPA` or `/learnIPA` would blow the performance budget; preloading the 3–10 files used on a word page is negligible.

**Acceptance criteria:**
- The rendered HTML for `/en-us/cupcake` contains `<link rel="preload" as="audio">` for each phoneme in the word.
- The rendered HTML for `/en-us/learnIPA` and for `/learnIPA` contains no preload links for phoneme audio.
- Lighthouse Performance score remains ≥ 90 on both pages (Charter §4, item 4).

#### FR-IPA-07 — Per-language `/:variant/learnIPA` page. *Priority: Must.*

The system shall serve, at `GET /:variant/learnIPA`, a page listing every phoneme in the `phonemes` table for the URL's variant, ordered by ascending frequency rank, with each row containing: the IPA symbol, a play-audio button, the example word, and the save/tag control defined in §4.3.

**Rationale:** Per-language phoneme inventories diverge across variants (American vs. British English alone differ in `/r/`-quality, vowel length, and rhoticity). A learner studying one variant should see only that variant's phonemes; the global cross-variant listing is the separate FR-IPA-10 page.

**Acceptance criteria:**
- The order of rows on `/en-us/learnIPA` equals the order returned by `SELECT … FROM phonemes WHERE variant = 'en-us' ORDER BY frequency_rank ASC`. The same query parameterised by `:variant` shall determine the ordering for any future variant.
- The page includes all phonemes for the URL's variant; the count equals the value displayed in the progress banner (FR-WORD-06) when viewed on a word page of the same variant.
- Each save control operates on the phoneme target and reflects the current save state for the viewer (if any).

#### FR-IPA-08 — Example-word matching by sound, not spelling. *Priority: Must.*

For every phoneme, the `phoneme_example_words` relation shall record the match mode (`sound` vs `spelling`). The example word displayed in the popover, on `/:variant/learnIPA`, and on `/learnIPA` shall be the one with `match_mode = 'sound'`, chosen for ubiquity and unambiguity of the target sound.

**Rationale:** Prevents Handoff's explicit pitfall (using a K-initial word for `/k/` when the example should be `cat`).

**Acceptance criteria:**
- Manual QA per phoneme confirms the example word demonstrates the target sound, not a matching letter.
- A linter or seed-validation test rejects phoneme rows where the target phoneme does not appear anywhere in the phonemic transcription of the displayed example word. Where the phoneme can occur word-initially the seed prefers a word-initial example; where it cannot (for example `/ŋ/` or `/ʒ/`), an example with the phoneme in any position is accepted.

#### FR-IPA-09 — IPA rendering fonts. *Priority: Should.*

The system shall render IPA symbols in a font stack that guarantees full IPA coverage across supported browsers, starting with a web-delivered IPA-aware font (e.g. Noto Sans) and falling back through the system IPA-capable families. Symbols such as `θ`, `ð`, `ŋ`, `ʃ`, `ʒ`, `ɹ`, `ɚ`, `ɫ` shall render correctly on every supported browser/OS pair.

**Rationale:** A "tofu" square in place of an IPA glyph destroys the product's core value.

**Acceptance criteria:**
- Playwright screenshot tests on Chrome, Firefox, and Safari (latest two majors) show every phoneme in `phonemes` rendering correctly, not as `.notdef` glyphs.

#### FR-IPA-10 — Global `/learnIPA` page. *Priority: Must.*

The system shall serve, at `GET /learnIPA`, a page listing every phoneme across every variant in the `phonemes` table, ordered by ascending frequency rank, with each row containing: the IPA symbol, a play-audio button, the example word, the save/tag control defined in §4.3, and a marker identifying the variant the phoneme belongs to. The page shall be reachable from the site footer; it shall not be linked from word pages or from `/:variant/learnIPA` in v1.0.

**Rationale:** The global page exists so that the URL `/learnIPA` is permanently the cross-variant index, not the English-only one. Locking this URL identity in v1.0 — when content is identical to `/en-us/learnIPA` because `en-us` is the only seeded variant — prevents a breaking change to external links, bookmarks, and search-engine indexing once additional variants are added post-v1.0. The footer placement is deliberate: in v1.0 a contextual in-page link from `/:variant/learnIPA` would be meaningless because both URLs render the same content; the footer is a stable, low-traffic discovery surface for users who genuinely want the cross-variant view.

**Acceptance criteria:**
- In v1.0, `/learnIPA` returns the same set of phoneme rows as `/en-us/learnIPA` because `en-us` is the only seeded variant in `phonemes`. Once a second variant is seeded, the global page's row count shall equal `SELECT COUNT(*) FROM phonemes`.
- The page is reachable from a footer link present on every page in v1.0.
- The page lazy-loads phoneme audio on demand (per FR-IPA-06); no `<link rel="preload" as="audio">` is emitted for phoneme files.
- Each save control operates on the phoneme target and reflects the current save state for the viewer (if any).

### 4.3 Save & tag system — `FR-SAVE-*`

#### FR-SAVE-01 — Unified save control for words and phonemes. *Priority: Must.*

The system shall provide a single save-control component used identically for word targets (on word pages) and phoneme targets (in phoneme popovers, on `/:variant/learnIPA`, and on `/learnIPA`). The control's visible state shall reflect, for the current viewer, one of four values: `unsaved`, `saved` (untagged), `learning`, `learned`.

**Rationale:** The Handoff fixes the save UX as one Instagram-style button with an optional tag popover; the same component must cover both target kinds so users encounter identical behaviour everywhere.

**Acceptance criteria:**
- The component's DOM structure (parametrised by `data-target-kind` ∈ `{word, phoneme}` and `data-target-id`) appears on word pages, in phoneme popovers, on `/:variant/learnIPA`, and on `/learnIPA`.
- All four states are visually distinguishable and announced accessibly (`aria-pressed` and `aria-label` reflect the state).
- The same JavaScript module handles activation for both target kinds.

#### FR-SAVE-02 — Three-state transitions. *Priority: Must.*

The save control shall implement the following state machine: from `unsaved`, a single activation transitions to `saved`; from any saved state (`saved`, `learning`, `learned`), a single activation opens a tag-choice popover without changing the stored state; selecting `Remove` in that popover transitions to `unsaved`; selecting `Learning` or `Learned` transitions to that tagged state; selecting `None` resets the state to `saved` (untagged), recorded as a `tag_change` event carrying a null value.

**Acceptance criteria:**
- From `unsaved`, one activation stores a `save` event and renders `saved`.
- From `saved`, one activation opens a popover offering `None`, `Learning`, `Learned`, `Remove`.
- Choosing `Learned` stores a `tag_change` event with value `learned` and renders `learned`.
- Choosing `Remove` stores an `unsave` event and renders `unsaved`.
- No state transition is possible without a corresponding event row being written.

#### FR-SAVE-03 — Append-only event log. *Priority: Must.*

Every state-changing action on a save target and every audio-listen and practice-attempt shall write a row to `user_activity_events` containing, at minimum: event ID (`event_id`, a `BIGINT AUTO_INCREMENT`), actor reference (exactly one of `anonymous_id` or `user_id` populated), target kind (`word` or `phoneme`), target ID, event type (`save`, `unsave`, `tag_change`, `audio_listen_word`, `audio_listen_phoneme`, `practice_attempt`), event value (nullable — the tag for `tag_change`, null for an untagged reset, the SM-2 rating for `practice_attempt`), and an occurrence timestamp (`occurred_at`, `DATETIME(3)` in UTC). Rows in `user_activity_events`, and `LINK` rows in the append-only `identity_bindings` history table, shall never be updated or deleted by application code except during account hard-deletion (see FR-SET-08).

**Rationale:** Append-only is the foundation of the merge-on-login rule and of the deterministic derivation of `user_word_states`, `user_phoneme_states`, and `sm2_states`.

**Acceptance criteria:**
- Tagging a saved word `learned` produces exactly one new row; no existing rows are modified.
- Application code has no code path that performs `UPDATE` or `DELETE` against `user_activity_events` outside the hard-deletion flow.
- The database user owned by the application has only `INSERT` and `SELECT` privileges on the append-only history-of-record tables `user_activity_events` and `identity_bindings`, and holds no `UPDATE` or `DELETE` on either. Destructive access is confined to the narrow erasure credential used by the deletion worker, limited to the tables and operations that erasure requires; the exact destructive-privilege surface is fixed in the deletion-flow and schema design. The two tables keep separate event-type vocabularies: `identity_bindings` carries `LINK` bindings and does not share the `user_activity_events` event-type enumeration.

#### FR-SAVE-04 — Derived state consistency. *Priority: Must.*

`user_word_states` and `user_phoneme_states` shall reflect, for each (actor, target) pair, the most recent qualifying event, excluding `audio_listen_word`, `audio_listen_phoneme`, and `practice_attempt`. The derivation rule is deterministic: qualifying events are ordered by `(occurred_at, event_id)`, and the latest such event's type/value dictates the state; earlier events are superseded but preserved in the log.

**Acceptance criteria:**
- For an actor whose event history for one word is `save → tag_change(learning) → tag_change(learned) → tag_change(learning)`, the derived state is `learning`.
- A dry-run recomputation script, executed against the event log, yields values identical to the live derived tables.
- If a drift is detected, a reconciliation script is available and scheduled (operationally covered in the Runbook).

#### FR-SAVE-05 — Anonymous saves work without registration. *Priority: Must.*

An anonymous visitor with a UUID cookie shall be able to exercise the full save/tag behaviour without creating an account. Their events shall be written against `anonymous_id` and their derived state shall be computed identically to that of a registered user.

**Rationale:** Charter Success Criterion 2 requires that anonymous visitors can save, tag, and practice without registering.

**Acceptance criteria:**
- A Playwright test in a fresh browser profile (no account) can save a word, tag it `learning`, and see the tag persist across a page reload.
- The event rows produced carry a non-null `anonymous_id` and a null `user_id`.

#### FR-SAVE-06 — Read-only degradation when cookies are disabled. *Priority: Must.*

If the server determines that a request carries no UUID cookie and the response's `Set-Cookie` will not be honoured (detected on the follow-up request via the `localStorage`-mirror rehydration path from Foundational Decisions §6), the save control on subsequent responses shall render in a disabled state with an accessible message: "Enable cookies to save your progress." No save or tag events shall be recorded.

**Rationale:** Foundational Decisions §6 fixes read-only as the explicit fallback; save without identity would produce orphan events.

**Acceptance criteria:**
- With browser cookies disabled globally, a save control on `/en-us/cupcake` renders in a disabled state with a visible explanation.
- No rows appear in `user_activity_events` for requests from such a client.
- Word pages otherwise render fully (meaning, IPA, audio controls still function).

#### FR-SAVE-07 — Save control behaviour without JavaScript. *Priority: Should.*

With JavaScript disabled but cookies enabled, the save control shall submit a standard HTML form (`POST /save`) that performs the save transition server-side and returns to the same page. Tag selection, which requires a popover, is not supported without JavaScript; untagged saved is the only reachable saved state in that mode.

**Rationale:** Progressive-enhancement promise for reading-related functionality (FR-WORD-08) can extend cheaply to the primary save action.

**Acceptance criteria:**
- With JS disabled, activating the save control on `/en-us/cupcake` results in an `unsaved → saved` transition and a fresh page load reflecting the state.
- The same form submission, when the target is already saved, yields an `unsave` transition (the control acts as a toggle in this mode).

#### FR-SAVE-08 — Idempotency and double-submit safety. *Priority: Must.*

Save-state-changing requests shall carry a CSRF token (Foundational Decisions §2, OWASP ASVS L2 control) and a client-generated idempotency key. The server shall ignore a duplicate request arriving within 30 seconds with the same idempotency key and return the current state.

**Rationale:** Double-taps and flaky networks must not produce duplicate `save`/`unsave` events that leave the derived state confused.

**Acceptance criteria:**
- Replaying the same `POST /save` request with the same idempotency key twice within 30 s results in exactly one new event row.
- A request without a valid CSRF token is rejected with HTTP 403.

#### FR-SAVE-09 — Audio-listen events. *Priority: Must.*

Playing whole-word audio shall write an `audio_listen_word` event, and playing phoneme audio shall write an `audio_listen_phoneme` event, to `user_activity_events`, tagged with the target kind and target ID. These events do not affect derived save state.

**Rationale:** Audio listens inform the future "your weakest phonemes are…" analytics that are out of scope for v1.0 but whose data should be captured now to avoid a rewrite later.

**Acceptance criteria:**
- Clicking a phoneme on `/en-us/cupcake` produces one `audio_listen_phoneme` event per click, rate-limited under §10.3 (save/tag bucket).
- Derived save state does not change as a consequence of an `audio_listen_word` or `audio_listen_phoneme` event.

### 4.4 Practice sessions — `FR-PRACTICE-*`

#### FR-PRACTICE-01 — Entry point and session construction. *Priority: Must.*

The system shall provide a "Practice my saved words" page at `GET /practice`. Requesting this page shall construct a session consisting of the viewer's saved words, scheduled by the SM-2 algorithm's due dates, with one word served at a time.

**Acceptance criteria:**
- For a viewer with zero saved words, the page renders an empty-state message and a link back to browsing.
- For a viewer with saved words, a session starts and the first due word is presented.
- The session is associated with a row in `practice_sessions` containing the actor, start timestamp, and initial queue snapshot.

#### FR-PRACTICE-02 — Frequency weighting by tag. *Priority: Must.*

Within a session, words tagged `learned` shall be asked at half the frequency of untagged (`saved`) and `learning` words. Concretely: when the scheduler would otherwise surface a `learned` word, it shall, with probability 0.5, defer that word to the next eligible slot and surface a non-`learned` due word instead if one is available.

**Rationale:** Handoff: "untagged and 'learning' words are asked at full frequency. 'Learned' words are asked at half frequency."

**Acceptance criteria:**
- A deterministic unit test with a seeded RNG and a queue of mixed-tag words reproduces the expected half-frequency ratio for `learned`.
- Over a large synthetic session (≥ 1 000 scheduled turns) the empirical frequency of `learned` words is 0.5 ± 0.05 of non-`learned` due words (95 % CI).

#### FR-PRACTICE-03 — Self-assessment UI. *Priority: Must.*

For each presented word, the system shall show the word and offer the viewer controls to hear it (whole-word audio, per-phoneme click-to-play), and two self-assessment buttons: "I got it right" and "I got it wrong". No microphone, ML, or speech-recognition input is accepted or recorded in v1.0.

**Acceptance criteria:**
- The practice page renders the word, the audio controls from §4.2, and the two assessment buttons.
- The page does not request microphone permission under any circumstance.
- Pressing a self-assessment button records a `practice_attempt` event (FR-SAVE-03) with the rating.

#### FR-PRACTICE-04 — SM-2 scheduling. *Priority: Must.*

The system shall implement the SM-2 algorithm for each (actor, word) pair, maintaining state in `sm2_states`: repetition count, ease factor (initialised to 2.5, floor 1.3), interval in days, next-due timestamp. Self-assessment "right" shall be interpreted as SM-2 quality 5; "wrong" as quality 2. Ease factors and intervals update per the standard SM-2 formulas.

**Rationale:** Handoff fixes SM-2 as the algorithm. Mapping self-assessment "right/wrong" to quality ratings 5/2 avoids the complication of a five-button grading UI while preserving SM-2's behaviour — quality 2 triggers a reset, quality 5 advances.

**Acceptance criteria:**
- Unit tests cover SM-2 state transitions for the initial rep, each subsequent correct rep, and an incorrect rep at each repetition count.
- Ease factor never drops below 1.3.
- Next-due timestamps are computed in UTC and stored to second precision.

#### FR-PRACTICE-05 — Wrong-answer reinsertion. *Priority: Must.*

When the viewer answers "wrong" for a word, in addition to the SM-2 reset, the word shall be reinserted into the current session's queue at a position chosen uniformly at random from 3 to 7 slots ahead of the current position (or at the end of the queue if fewer than 3 slots remain).

**Rationale:** The Handoff explicitly calls for 3–7 round reinsertion to give the learner a short-loop second chance within the same session, independent of SM-2's next-day interval.

**Acceptance criteria:**
- A deterministic unit test with a seeded RNG reproduces a reinsertion offset in the inclusive range [3, 7].
- If the queue has fewer than 3 remaining slots, the word is placed at the tail.
- The reinsertion does not create duplicate `practice_attempt` events until the user actually answers the re-presented word.

#### FR-PRACTICE-06 — Session termination. *Priority: Must.*

A practice session shall end when: the viewer has answered every due word at least once and no reinsertions remain queued; or the viewer leaves the practice page; or the session's absolute idle timeout (60 minutes) elapses. On termination the `practice_sessions` row is finalised (end timestamp, total attempts, correct count).

**Rationale:** The practice idle timeout is a user-experience concern, not a security one, so it intentionally diverges from the 30-minute authentication-session idle timeout (Foundational Decisions §2). Sixty minutes is forgiving of natural pauses — looking something up, a phone call, stepping away — while still bounded enough that abandoned sessions do not accumulate.

**Acceptance criteria:**
- Completing a short session (3 due words, no wrong answers) finalises the row with `end_ts`, `total_attempts = 3`, `correct_count = 3`.
- Closing the tab mid-session causes the row to be finalised on the next scheduled sweep (operationally covered in the Runbook) or on the user's next visit, whichever is first.
- A 60-minute idle timer fires a finalisation event when no interaction occurs.

#### FR-PRACTICE-07 — Practice of phonemes. *Priority: Won't (this release).*

`[OUT-OF-SCOPE for v1.0]` IPA-subset practice (asking the user to pronounce a word composed of specific phonemes) is deferred past v1.0. Requires a word-search algorithm over phoneme subsets and is explicitly listed in Charter §6 and Handoff's post-v1.0 section.

### 4.5 Authentication & account lifecycle — `FR-AUTH-*`

#### FR-AUTH-01 — Anonymous UUID cookie issuance. *Priority: Must.*

The system shall issue and maintain an anonymous identity cookie named `pa_uid`, a v4 UUID, with attributes `HttpOnly=false` (required for the `localStorage` mirror in Foundational Decisions §6), `Secure`, `SameSite=Lax`, `Path=/`, and `Max-Age=63072000` (two years, sliding). Because the word page shell is a shared, edge cached response (SDD decision B2), it must not carry a per viewer `Set-Cookie`, and a cache hit on it does not reach the origin; the cookie is therefore issued and its `Max-Age` refreshed on uncached responses that reach the origin, not on the cacheable shell. The system shall issue the cookie on the first uncached origin reaching request that does not already carry a valid `pa_uid`, which for a client running JavaScript is the viewer bootstrap or hydration request made on page load and otherwise is the first write or other non cached request, and shall refresh the `Max-Age` on every subsequent uncached origin reaching response so the lifetime slides. For a client running JavaScript the bootstrap or hydration request already fires on every word page view under B2, so issuance and sliding refresh add no round trip beyond that request and do not depend on the cached shell.

**Rationale:** Foundational Decisions §6 locks sliding 2-year expiry and mirrors the UUID into `localStorage` as an explicit tradeoff; the mirror needs JS access, hence no `HttpOnly`. This is an accepted tradeoff — any XSS that could read `localStorage` could also read this cookie; see Threat Model.

**Acceptance criteria:**
- The first uncached origin reaching response to a fresh client (the viewer bootstrap or hydration response, or a first write response) includes `Set-Cookie: pa_uid=…; Max-Age=63072000; Path=/; Secure; SameSite=Lax`.
- A cache hit on the word page shell carries no `Set-Cookie` for `pa_uid`.
- Every subsequent uncached origin reaching request that carries the cookie yields a response that refreshes `Max-Age`.
- The cookie value is a valid v4 UUID.

#### FR-AUTH-02 — `localStorage` mirror and rehydration. *Priority: Must.*

On every response, the client-side bootstrap script shall mirror the current `pa_uid` cookie value into `localStorage` under the key `pa_uid`. On every request to a page that requires a UUID, if the cookie is missing but `localStorage.pa_uid` is present, the client shall rehydrate the cookie from `localStorage` before the save/tag or practice flow runs; if that rehydration completes before the first write request, the server treats the visitor as a continuing anonymous profile.

**Rationale:** Foundational Decisions §6 — self-healing against "clear cookies" tools that leave `localStorage` intact.

**Acceptance criteria:**
- A Playwright test that clears cookies (but not `localStorage`), reloads the page, and then saves a word, results in the save being recorded against the original `anonymous_id`, not a freshly-issued one.
- Clearing both cookies and `localStorage` results in a new `anonymous_id`.

#### FR-AUTH-03 — Anonymous profile persistence. *Priority: Must.*

The first time a fresh UUID appears in a write request (a save, tag change, or practice attempt), the system shall create an `anonymous_profiles` row keyed to that UUID. Until that first write, no `anonymous_profiles` row is created — the cookie alone is not personal data that warrants DB storage.

**Rationale:** Data minimisation (GDPR Art. 5(1)(c)). Read-only visitors never cause a DB row.

**Acceptance criteria:**
- `GET /en-us/cupcake` with a fresh UUID does not insert a row into `anonymous_profiles`.
- A subsequent `POST /save` from the same UUID inserts exactly one row.

#### FR-AUTH-04 — Three registration paths. *Priority: Must.*

The system shall support exactly three registration paths, each producing one `users` row with a unique `user_id` and associated `user_accounts` row(s): (a) Google OAuth 2.0; (b) email + password; (c) username + password, with an optional email field. All three paths require the user to choose a unique username during their first registration step.

**Rationale:** Foundational Decisions §7 locks this triad.

**Acceptance criteria:**
- `/register` offers all three paths.
- Each path produces exactly one `users` row and the appropriate `user_accounts` row(s).
- Attempting to complete any path without a username fails validation.

#### FR-AUTH-05 — Username rules. *Priority: Must.*

Usernames shall: be unique across all accounts under case-insensitive comparison; consist of 3–20 characters from `[a-zA-Z0-9_-]`; begin with a letter (`[a-zA-Z]`); be stored in the form the user typed but compared case-insensitively. No discriminator (`#1234`) is appended. Reserved usernames are rejected: administrative and role-like handles (e.g. `admin`, `administrator`, `root`, `sysadmin`, `moderator`, `support`, `staff`, `owner`, `system`), application route and brand-squat strings, and profanity. The administrative and route lists are maintained in a source-controlled config file; the profanity set is drawn from an externally maintained blocklist loaded at startup (specific package selected in the SDD). The full launch baseline is in Appendix A.

**Acceptance criteria:**
- `Alp`, `alp`, `ALP` cannot coexist; the second and third attempts fail with a clear error.
- `ab` (too short) and `a_really_long_username_01` (too long) are rejected.
- `1abc` (starts with digit) is rejected.
- `root` is rejected as reserved.
- Successful registration stores the username as typed (for display) and compares it lowered (for uniqueness).

#### FR-AUTH-06 — Email uniqueness across accounts. *Priority: Must.*

An email address associated with any account (verified or pending verification) shall not be accepted as the primary email for any other account. Attempts to register or to add such an email return a generic error ("this email cannot be used for registration") without revealing whether the email is already in use, so the error does not double as an account-enumeration oracle.

**Rationale:** Foundational Decisions §7 mandates email uniqueness; Foundational Decisions §2 mandates generic error messages to prevent enumeration.

**Acceptance criteria:**
- Registering a second account with an email used by a first account fails with a generic error.
- The error message does not distinguish "already in use" from other validation failures.
- The rate-limit bucket for `/register` (Foundational Decisions §10.3) applies regardless of the specific error.

#### FR-AUTH-07 — Password policy. *Priority: Must.*

Passwords shall: be at least 8 characters long; have no upper bound below 100 characters; impose no composition complexity rules (no forced uppercase, digit, or symbol); be checked against the Have I Been Pwned range API using SHA-1 k-anonymity (only the first 5 hex characters of the hash leave the server). Passwords present in HIBP with a count ≥ 1 are rejected with "this password has appeared in a known breach; please choose another."

**Rationale:** NIST SP 800-63B Rev 3 §5.1.1.2 (memorized-secret composition rules and breached-password screening requirements). The 8-character minimum and 100-character maximum mirror Google consumer Gmail's password policy (see Foundational Decisions §2).

**Acceptance criteria:**
- `aaaaaaaa` (8 chars) is structurally acceptable but is rejected by the HIBP check (it appears in HIBP with very high count).
- `password` (8 chars) is rejected by the HIBP check.
- `correct horse battery staple` is accepted if not in HIBP.
- A password of length 7 is rejected with an explicit length message.
- A password of length 101 is rejected with a length message.
- Only the first 5 chars of the SHA-1 hash leave the server (verified by a network trace in a test).

#### FR-AUTH-08 — Password hashing. *Priority: Must.*

Stored passwords shall be hashed with bcrypt at cost factor 12. No plaintext or reversible representation of a password shall ever be logged, emailed, or written to an audit record.

**Acceptance criteria:**
- Every row in `user_accounts` for the email+password and username+password paths has a `password_hash` beginning with `$2b$12$`.
- Grepping logs for any test password reveals no matches across application, access, and error logs.

#### FR-AUTH-09 — Email verification (required where email is set). *Priority: Must.*

For the email-path and for username-path accounts that opted to provide an email, the system shall send a verification email containing a single-use link that expires 24 hours after issuance. Login shall be blocked until the link is clicked.

**Rationale:** Foundational Decisions §7.

**Acceptance criteria:**
- Creating an account via the email path sends exactly one verification email.
- Clicking the link within 24 h marks the account verified and permits login.
- Clicking the link after 24 h shows an "expired — request a new link" page and does not verify the account.
- Using the same link twice is rejected (single-use).
- Unverified accounts cannot log in; the login page shows a "verify your email" message with a "resend" action.

#### FR-AUTH-10 — Verification resend. *Priority: Must.*

A user may request a new verification email at most 3 times per hour per account ID (rate limit per Foundational Decisions §10.3). Each new link invalidates all previous links for that account.

#### FR-AUTH-11 — Password reset. *Priority: Must.*

A user with a verified email may request a password reset at `/reset-password`. The system sends a single-use link with 1-hour expiry. Clicking the link lets the user set a new password (subject to FR-AUTH-07). On successful password change: the reset token is invalidated; all active sessions for the user are terminated; a notification email is sent to the verified address.

**Rationale:** Foundational Decisions §2.

**Acceptance criteria:**
- Requesting a reset for an unknown email returns the same generic success message as for a known email (no enumeration).
- Clicking the link within 1 h and setting a valid new password succeeds.
- The reset link is rejected after 1 h, after successful use, and after any password change from any device.
- All sessions are terminated — the user's other devices are forced to re-authenticate on their next request.

#### FR-AUTH-12 — Session issuance and rotation. *Priority: Must.*

On successful authentication the system shall issue a session token stored in a cookie named `pa_sid` with attributes: `HttpOnly=true`, `Secure`, `SameSite=Lax`, `Path=/`. Sessions idle-timeout after 30 minutes and absolute-timeout after 12 hours. The session token shall be rotated on login and on password change.

**Rationale:** Foundational Decisions §2.

**Acceptance criteria:**
- After 30 minutes of no request activity, the next request redirects to `/login`.
- At the 12-hour mark since login, the next request redirects to `/login` regardless of activity.
- The session cookie's value immediately after login differs from any previous value for that account.
- The session cookie's value immediately after a password change differs from the pre-change value.

#### FR-AUTH-13 — Generic authentication error messages. *Priority: Must.*

The login form shall respond to every failed login with a single, generic message ("Invalid username/email or password"). The response shall not distinguish between "no such user", "wrong password", "unverified email", or "soft-deleted account" in timing or content sufficient to enumerate accounts. The "unverified email" hint shown post-login on FR-AUTH-09 is a separate, explicit affordance only after a valid credential pair has been presented.

**Acceptance criteria:**
- Attempting to log in with a known username but wrong password returns the same message and status code as an unknown username.
- Response time for both cases differs by less than a threshold documented in the Threat Model (constant-time compare over the credential check).

#### FR-AUTH-14 — Turnstile on sensitive endpoints. *Priority: Must.*

The endpoints `POST /register`, `POST /login`, `POST /reset-password`, and `POST /request-word` shall require a valid Cloudflare Turnstile token, verified server-side on each submission. Invalid or missing tokens are rejected with HTTP 400.

**Rationale:** Foundational Decisions §9. Turnstile is privacy-respecting and sets no cross-site tracker.

**Acceptance criteria:**
- Submitting any of the four endpoints without a Turnstile token returns HTTP 400.
- Submitting with a token that fails server-side verification returns HTTP 400.
- A valid token is single-use; replaying it returns HTTP 400.

#### FR-AUTH-15 — Rate limiting on authentication endpoints. *Priority: Must.*

The rate limits defined in Foundational Decisions §10.3 shall be enforced at the application layer against a Redis-backed counter: `POST /login` 5 per 15 min per (UUID + IP); `POST /register` 3 per 1 h per IP; `POST /reset-password` 3 per 1 h per email; `POST /verify-email/resend` 3 per 1 h per account ID. On breach the response is HTTP 429 with a `Retry-After` header.

**Acceptance criteria:**
- The 6th login attempt within 15 min from the same (UUID + IP) pair returns HTTP 429.
- The `Retry-After` header's value is a non-negative integer number of seconds.
- The counter store is Redis in the staging and production environments.

#### FR-AUTH-16 — Google OAuth scope. *Priority: Must.*

The Google OAuth integration shall request only the scopes needed for registration and login: `openid`, `email`, `profile` (for display name + profile picture). No additional scopes (Drive, Contacts, YouTube, etc.) shall be requested.

**Rationale:** Data minimisation; Charter §4 item 6.

#### FR-AUTH-17 — Registration nudge after 5 anonymous saves. *Priority: Should.*

When an anonymous visitor has reached 5 saved items (words + phonemes, counted by derived state), the system shall show a one-time, dismissible nudge suggesting account creation. Dismissal shall be persisted in `localStorage` so the nudge does not reappear on the same browser.

**Rationale:** Foundational Decisions §6.

**Acceptance criteria:**
- On the save transition that moves the viewer's count from 4 to 5, the next rendered page shows the nudge.
- Dismissing the nudge writes `pa_register_nudge_dismissed=1` to `localStorage` and hides the nudge for the rest of the browser session and beyond.
- The nudge never appears for users who are already logged in.

#### FR-AUTH-18 — Merge-on-login rule. *Priority: Must.*

When a user successfully authenticates and the browser carries a non-empty anonymous UUID whose `anonymous_profiles` row is not already linked to an account, the system shall associate the anonymous activity with the registered account by appending a `LINK` binding (anonymous identity to user) to the append-only `identity_bindings` table; existing `user_activity_events` rows are never modified. An anonymous identity binds to at most one account: a bound identity is never linked again, and continued anonymous use after a link is served by a newly issued anonymous identity. Derived-state tables are recomputed post-merge across the linked identities. The derived-state merge rule is: for each (target kind, target ID), the latest event by (occurred_at, event_id) wins.

**Rationale:** Handoff. Latest-event-wins produces a deterministic merge that handles cross-device use without ambiguous reconciliation prompts. Event timestamps are recorded at millisecond precision (`DATETIME(3)`), and ordering by `(occurred_at, event_id)` provides a deterministic total order, so any same-millisecond collision for a single target is resolved by the monotonic `event_id` rather than left ambiguous.

**Acceptance criteria:**
- An anonymous user who tagged `cupcake` as `learning` at T1, then logs into an account where `cupcake` was tagged `learned` at T0 (earlier), has `cupcake` end up as `learning` in the merged account.
- Event timestamps are stored at millisecond precision (`DATETIME(3)`); when two events for the same target fall in the same millisecond, resolution is deterministic via the monotonic `event_id`, so ordering by `(occurred_at, event_id)` always yields a single latest event.
- The anonymous UUID becomes dormant after merge: subsequent use of that browser before a new anonymous UUID is issued routes events to the registered account.

#### FR-AUTH-19 — Cross-device anonymous → registered merge. *Priority: Must.*

If an already-logged-in user returns to a different device that has its own anonymous UUID profile, logging in on that device shall merge the new device's anonymous events into the same user account under the same latest-event-wins rule. A user who signs into a different account on a different device: those anonymous events are merged into the other account and cannot be recovered.

**Rationale:** Handoff states: "If they sign into a different account on a different device, those anonymous events go to that other account — nothing can be done."

#### FR-AUTH-20 — CSRF protection on state-changing POSTs. *Priority: Must.*

All state-changing `POST` / `PATCH` / `DELETE` endpoints shall require a CSRF token tied to the current session (or the anonymous UUID for pre-login flows). Requests without a valid token are rejected with HTTP 403. Tokens are issued on page render and rotated on login, logout, and password change.

**Rationale:** OWASP ASVS L2 control.

### 4.6 Consent, cookies & legal — `FR-CONSENT-*`

#### FR-CONSENT-01 — Strictly-necessary cookie acknowledgement banner. *Priority: Must.*

On first visit the system shall display a banner stating that PronounceAll uses one strictly-necessary cookie (`pa_uid`) to save word-learning progress, with a link to the full Privacy Policy. The banner has one affordance: "OK, got it." The banner is an acknowledgement, not a consent request; no "reject" option is offered because GDPR and KVKK do not require consent for strictly-necessary cookies.

**Rationale:** Handoff explicitly frames this as acknowledgement. Offering a reject button for an essential cookie would be misleading because the site cannot function without it.

**Acceptance criteria:**
- The banner appears on first visit when no `pa_uid_ack` entry is present in `localStorage`.
- Clicking "OK, got it" writes `pa_uid_ack=1` to `localStorage` and hides the banner.
- The link to the Privacy Policy is reachable and returns HTTP 200.
- The banner is announced accessibly (it is a landmark; focus is manageable).

#### FR-CONSENT-02 — Cookie table accuracy. *Priority: Must.*

The Privacy Policy shall contain a cookie table listing every cookie the site may set, including at minimum: `pa_uid` (strictly necessary, 2-year sliding), `pa_sid` (session, 12 h absolute / 30 min idle; only for logged-in users), `XSRF-TOKEN` or equivalent CSRF cookie, and any Cloudflare cookies set at the edge. For each cookie: name, purpose, duration, scope, and category (strictly necessary vs non-essential).

**Acceptance criteria:**
- The cookie table matches the set actually produced by the running system, verified by an automated check that compares `Set-Cookie` headers observed in an end-to-end flow against the table.

#### FR-CONSENT-03 — Consent records for ad opt-in. *Priority: Must.*

If and when ads are activated and a user opts in via Settings (FR-SET-04), the system shall write a row to `consent_records` with: actor reference, consent type (`ads_opt_in`), value (`granted`), timestamp, and the policy version in effect at the moment. Withdrawal produces a second row with value (`revoked`). No ad cookies shall be set unless the most recent record for the actor is `granted`.

**Rationale:** GDPR Art. 7 — consent must be withdrawable and demonstrably recorded.

**Acceptance criteria:**
- Toggling ads on in Settings inserts a `granted` row.
- Toggling ads off inserts a `revoked` row.
- The ad-serving decision on every page load consults the latest record.

#### FR-CONSENT-04 — Username-only path: no-recovery acknowledgement. *Priority: Must.*

A user completing the username-only registration path without supplying an email shall be required to tick a checkbox acknowledging: "Without an email, we cannot recover your account if you forget your credentials. You accept this risk." This acknowledgement shall be recorded in `consent_records` with type `no_recovery_ack`.

**Rationale:** Foundational Decisions §7.

#### FR-CONSENT-05 — Privacy Policy in English and Turkish. *Priority: Must.*

The system shall serve a Privacy Policy in English at `/privacy` and a KVKK *Aydınlatma Metni* in Turkish at `/kvkk`. Both pages are publicly reachable without a logged-in session and without triggering any conditional cookie. Both are referenced from the consent banner and from the footer of every page.

**Acceptance criteria:**
- `GET /privacy` and `GET /kvkk` both return HTTP 200.
- The English policy covers: data collected, purposes, legal bases, retention, recipients, rights (access, rectification, erasure, objection), contact for data requests, supervisory-authority information.
- The Turkish KVKK notice covers the items required by KVKK Art. 10: data controller identity, purpose, recipients, method and legal basis, data subject rights under Art. 11.
- Final legal wording is drafted in collaboration with Claude and, per the Handoff, reviewed by someone with legal knowledge before go-live.

#### FR-CONSENT-06 — No non-essential cookies by default. *Priority: Must.*

Until a non-essential cookie's explicit consent is recorded (e.g. the ad opt-in), the system shall not set that cookie and shall not include any third-party script that sets such a cookie.

**Rationale:** Charter §4 item 6.

**Acceptance criteria:**
- An end-to-end Playwright test that visits every public route without logging in and without opting into ads produces only cookies listed as "strictly necessary" in the cookie table.
- A CSP review confirms no third-party ad/analytics domains are loaded by default.

### 4.7 Open-source banner — `FR-OSS-*`

#### FR-OSS-01 — Banner presence. *Priority: Must.*

Every page rendered by the application shall include a small, non-intrusive banner stating that PronounceAll is open-source and free, linking to the GitHub repository. The banner is not an ad surface and is not used to request consent.

#### FR-OSS-02 — Dismissal and 30-minute reappearance. *Priority: Must.*

The banner shall be dismissible by a close control. On dismissal the client shall write `pa_oss_dismissed_until=<timestamp + 30 minutes>` to `localStorage` and hide the banner on subsequent page renders until that timestamp has passed. No cookie is used.

**Rationale:** Handoff — dismissal state belongs in `localStorage` to keep the cookie table minimal.

**Acceptance criteria:**
- Dismissing the banner on `/en-us/cupcake` hides the banner on `/en-us/muffin` for the next 30 minutes.
- After the 30-minute window the banner reappears on the next page load.
- No cookie is set as a consequence of dismissal.

### 4.8 Settings — `FR-SET-*`

#### FR-SET-01 — Settings page availability. *Priority: Must.*

The system shall serve a Settings page at `GET /settings`, available to both anonymous visitors and registered users. Sections not applicable to anonymous visitors (account management, logout) are hidden or disabled with an accessible explanation.

#### FR-SET-02 — Account management. *Priority: Must.*

For a registered user, the Settings page shall offer: change email (subject to FR-AUTH-06 uniqueness and re-verification), change password (subject to FR-AUTH-07 and requiring current password), and Delete account (opens the two-step flow in FR-SET-07). Changing email sends a re-verification email to the new address; the new address is not active until verified.

**Acceptance criteria:**
- Submitting a new email triggers a verification email to that address and leaves the old address active until verification.
- Submitting an incorrect current password rejects the password change with a generic error.
- The Change email and Change password forms require a valid CSRF token.

#### FR-SET-03 — Cookie preferences panel. *Priority: Must.*

The Settings page shall contain a cookie-preferences panel listing every cookie category. Strictly-necessary cookies (containing at minimum `pa_uid` and `pa_sid`) are shown as grayed-out toggles, with a short per-cookie explanation of why each is required. Non-essential categories (initially: ads) have real toggles whose state corresponds to the most recent `consent_records` entry (FR-CONSENT-03).

**Acceptance criteria:**
- The essential toggles cannot be turned off via the UI.
- Attempting to POST a request that would disable an essential toggle is rejected at the server with HTTP 400.
- Toggling the ads category writes a `consent_records` row.

#### FR-SET-04 — Ad opt-in toggle. *Priority: Must.*

The cookie-preferences panel shall expose an "Enable ads" toggle. The toggle is off by default. Flipping it on records `granted` consent (FR-CONSENT-03); flipping it off records `revoked` consent and invalidates any ad cookie previously set. v1.0 ships only the toggle and the consent record — no ad network is wired up.

**Rationale:** Charter §6 — opt-in toggle ships; no network is integrated until a privacy-compatible partner is identified.

#### FR-SET-05 — Language variant selector. *Priority: Must.*

The Settings page shall expose a language-variant selector. In v1.0 the selector is present but its only option is American English (`en-us`), which is preselected. The UI makes clear that additional variants are planned.

**Rationale:** The dropdown slot exists from day one so adding `en-gb`, `fr-fr`, etc., is a content update, not a UI change.

#### FR-SET-06 — Logout. *Priority: Must.*

The Settings page shall expose a Logout control. Activating it destroys the server-side session, clears the `pa_sid` cookie, and redirects to the home page. The `pa_uid` cookie is preserved; the now-logged-out user retains any anonymous UUID that was re-bound to them on login (see FR-AUTH-18's note on dormancy — a new anonymous UUID is issued going forward unless the browser still carries the pre-merge one).

**Acceptance criteria:**
- After logout the `pa_sid` cookie is either unset or has `Max-Age=0`.
- Protected pages redirect to `/login` post-logout.
- The `pa_uid` cookie is unchanged by logout.

#### FR-SET-07 — Account deletion — two-step flow. *Priority: Must.*

Activating "Delete account" from Settings shall initiate a two-step flow: (1) an explanation screen describing the two options — soft delete (30-day grace, login restores) and hard delete (irreversible, data purged within 24 h) — and requiring re-authentication (password re-entry, or a fresh Google OAuth round-trip); (2) an option-selection screen that, upon confirmation, executes the chosen option and logs the user out. A confirmation email is sent on completion to the verified address, if any, containing a "this wasn't me" contact link for the soft-delete case.

**Rationale:** GDPR Art. 17 right to erasure; Foundational Decisions §8 locks both options and requires re-authentication to block session-hijack deletion.

**Acceptance criteria:**
- Entering an incorrect password at the re-authentication step aborts the flow.
- Choosing soft delete disables the account and schedules the hard-delete job at now + 30 days.
- Choosing hard delete triggers the purge job (FR-SET-08) within 24 hours.
- A confirmation email is sent in both cases if a verified email exists.

#### FR-SET-08 — Hard-delete data purge. *Priority: Must.*

The hard-delete job shall permanently remove or irreversibly anonymise: the `users` row, all `user_accounts` rows for that user, all `user_word_states` and `user_phoneme_states` rows, all `sm2_states` rows, all `practice_sessions` and `practice_attempts` rows, the user-owned subset of `user_activity_events` (including events originating from anonymous identities bound to the account), all `identity_bindings` rows binding an anonymous identity to that account, all `consent_records` rows, all session rows. Word requests previously submitted by the user are retained with the `submitted_by_user_id` nulled (they become ownerless). A tombstone row referencing a deletion ID (no PII) is retained for audit.

**Rationale:** Foundational Decisions §8.

**Acceptance criteria:**
- After a hard-delete the email and username are available for reuse by a future registration.
- No PII remains in the named tables for the deleted user, and no `identity_bindings` row associating an anonymous identity with the deleted account remains.
- The audit tombstone contains no PII; it records the deletion ID and timestamp only.

#### FR-SET-09 — Soft-delete restoration. *Priority: Must.*

During the 30-day soft-delete window, a successful login (credential correct; if the path requires email, still possible because the email and password rows exist) shall restore the account: unset the soft-delete flag, re-enable the account, cancel the scheduled hard-delete job, and record the restoration in `consent_records` with type `account_restored`.

**Acceptance criteria:**
- Logging in on day 29 of a soft-delete window fully restores the account.
- Logging in on day 31 is rejected (the account has already been hard-deleted).

#### FR-SET-10 — Settings page for anonymous visitors. *Priority: Should.*

For an anonymous visitor, the Settings page shall show the cookie-preferences panel (FR-SET-03) and the language selector (FR-SET-05), and shall suggest account creation as the way to unlock account management. The ad-opt-in toggle is still available and writes an anonymous `consent_records` row keyed to `anonymous_id`.

### 4.9 Content & data seeding — `FR-CONTENT-*`

#### FR-CONTENT-01 — Dictionary seed from open sources. *Priority: Must.*

The `words` and `word_pronunciations` tables shall be seeded from open dictionary sources, primarily Wiktionary, preserving upstream attribution. The seed process is scripted, idempotent, and reproducible from a documented command in the Runbook.

**Acceptance criteria:**
- Running the seed script from scratch on an empty database produces the launch dataset deterministically.
- Every seeded word has a recorded upstream source URL and licence note (`CC BY-SA 4.0` for Wiktionary).

#### FR-CONTENT-02 — Phoneme seed and audio assets. *Priority: Must.*

The `phonemes` table and the associated phoneme audio assets shall be seeded at Iteration 2 (per the Handoff's locked iteration order). Each phoneme has at least one audio asset and one example word satisfying FR-IPA-08.

#### FR-CONTENT-03 — TTS batch audio for whole-word fallback. *Priority: Must.*

For every seeded word lacking a Wiktionary human recording, the system shall hold a pre-generated TTS audio asset, produced once by the seed pipeline using the chosen TTS provider (provider choice deferred to SDD, per Handoff §Open Questions). The TTS assets are stored as flat files served by Nginx, not streamed from the TTS provider at runtime.

**Rationale:** Avoids per-request cost, per-request latency, and the need for a provider-facing runtime dependency.

**Acceptance criteria:**
- For a sample of 100 seeded words without Wiktionary recordings, each has a TTS file present in the audio asset directory.
- Runtime word-page loads perform no outbound request to the TTS provider.

#### FR-CONTENT-04 — Audio asset integrity. *Priority: Must.*

Every audio asset referenced by `audio_assets` shall have: a file present on disk at the expected path, a recorded SHA-256 digest, a recorded MIME type, a non-zero byte length, and recorded provenance and licensing (source reference, author, licence identifier, licence URL, attribution text, and retrieval date). A startup or nightly integrity check verifies each referenced asset. The seed validation stage rejects or flags any asset whose licence is incompatible with the project's intended use and processing, assessed against actual use rather than a licence family in the abstract.

**Acceptance criteria:**
- The integrity check running against the launch dataset reports zero missing, zero digest mismatches, zero zero-byte files.
- Every referenced asset has a recorded licence identifier and attribution text, and the seed validation reports zero assets with missing or incompatible licensing.

#### FR-CONTENT-05 — Upstream attribution on word pages. *Priority: Must.*

Every word page shall display, in a visible footer or near the meaning, the upstream source attribution and licence for the meaning (e.g. "Meaning from Wiktionary · CC BY-SA 4.0") with a link to the source entry. Where an audio asset carries its own licence and author, its attribution shall be provided in the manner that asset's licence requires, distinct from the meaning attribution; whether it appears beside the player or on a dedicated attribution surface is a design decision.

**Rationale:** CC BY-SA 4.0 requires attribution; the Charter §7 pledges to preserve upstream licensing terms.

#### FR-CONTENT-06 — Language-variant table. *Priority: Must.*

The `language_variants` table shall contain exactly one row for v1.0: `en-us` with a human-readable name ("American English") and an `is_active = true` flag. Routes to inactive variants return HTTP 404.

#### FR-CONTENT-07 — Word-request processing workflow. *Priority: Should.*

The maintainer shall have a documented operational workflow (in the Runbook) for reviewing, accepting, and rejecting rows in `word_requests`. v1.0 does not ship an in-app admin UI; the workflow operates via database queries and re-runs of the seed pipeline. Acceptance creates `words` and `word_pronunciations` rows; rejection flags the request row.

**Rationale:** Handoff defers admin UI past v1.0; the operational procedure still needs to exist.

---

## 5. Non-functional requirements

NFRs follow the same hybrid style as FRs (§3.3): shall-statement, MoSCoW priority, rationale where non-obvious, acceptance criteria on non-trivial items. Where an FR already pins a specific numeric or behavioural value (e.g. FR-IPA-04 for phoneme audio latency, FR-AUTH-07 for password policy), the NFR references the FR rather than duplicating the requirement. This keeps a single source of truth per rule.

### 5.1 Security — `NFR-SEC-*`

#### NFR-SEC-01 — OWASP ASVS Level 2 baseline. *Priority: Must.*

The system shall satisfy the applicable controls of OWASP ASVS v5.0.0 Level 2. Every ASVS control that is not applicable (e.g. controls specific to SPA frameworks when the app is server-rendered, controls specific to native mobile clients) shall be listed in the Threat Model with a written justification for its non-applicability.

**Rationale:** Foundational Decisions §2 locks ASVS L2 as the target. L2 is the pragmatic bar for a privacy-respecting public site without military or payments data.

**Acceptance criteria:**
- An ASVS L2 control-mapping document exists in the repo (generated/maintained alongside the Threat Model).
- Every L2 control is either "implemented" (with a pointer to the implementing FR or code location), "not applicable" (with a one-line reason), or "deferred post-v1.0" (with a Risk Register entry).

#### NFR-SEC-02 — TLS configuration. *Priority: Must.*

All public traffic shall be served over TLS. The Cloudflare edge shall enforce TLS 1.2 minimum with TLS 1.3 preferred and modern cipher suites only (no RC4, no 3DES, no CBC-mode ciphers in TLS 1.2 negotiation). The origin-facing connection between Cloudflare and the VPS shall use a valid certificate provisioned by Certbot. HTTP Strict Transport Security (HSTS) shall be deployed as a four-phase, stability-milestone-tied ramp rather than at a single fixed value from launch:

| Phase | Trigger to advance | `max-age` value | Other directives |
|-------|--------------------|-----------------|------------------|
| Launch (post-Iteration 7 deploy) | — | 300 (5 min) | none |
| Initial stability confirmed | No HTTPS/TLS incidents during the prior phase | 86,400 (1 day) | none |
| Sustained stability | Continued absence of TLS / Cloudflare / cert incidents | 2,592,000 (30 days) | none |
| Mature posture | Maintainer judges the TLS configuration settled and unlikely to change | 15,552,000 (180 days) | `includeSubDomains; preload` + submission to the HSTS preload list |

Each advance is a maintainer decision tied to an observed stability milestone, not a calendar trigger, consistent with the project's iteration-and-milestone cadence. The ramp is monotonically non-decreasing, as the HSTS specification requires: `max-age` may only increase or be reset to 0, never decreased to a lower non-zero value, because browsers cache the higher value.

**ASVS v5.0.0 conformance note.** Requirement v5.0.0-3.4.1 (L1, inherited by L2) requires a `Strict-Transport-Security` header with a minimum `max-age` of one year and, at L2, `includeSubDomains`. Phases 1–3 of this ramp (5 minutes, 1 day, 30 days, all without `includeSubDomains`) are deliberately below that floor as a defensive choice during initial deployment, when TLS / Cloudflare / Certbot misconfigurations are most likely and fast recoverability matters more than long-term posture. Full conformance with v5.0.0-3.4.1 is reached at phase 4 (180 days + `includeSubDomains` + preload). The temporary non-conformance during phases 1–3 shall be recorded in the ASVS L2 control-mapping document required by NFR-SEC-01 as an explicit, time-bounded deferred control, with the phase-4 milestone trigger as its resolution criterion.

**Rationale:** Foundational Decisions §2 requires HSTS with preload; this NFR fixes the TLS and cipher posture explicitly so a future configuration drift is catchable. A solo-dev launch will produce TLS / Cloudflare / Certbot mistakes in the first weeks of production; a 5-minute `max-age` at launch means recovery from any such mistake is near-instant, because browsers forget the rule before the post-mortem is written. Stepping up only after each phase demonstrates stability reaches the same final posture as launching at six months plus preload, but without the painful rollback path. Preload-list submission is intentionally last because de-listing takes weeks and ships only with browser updates.

**Acceptance criteria:**
- `curl -sI https://pronounceall.com/` returns an HSTS header whose `max-age` matches the current ramp phase.
- `testssl.sh` (or equivalent) against the production host reports no findings above "LOW".
- Preload-list submission occurs only at the mature-posture phase (phase 4); it is not required at launch, and the ASVS L2 control-mapping document records the phased deferral until then.

#### NFR-SEC-03 — Content Security Policy. *Priority: Must.*

Every HTML response shall carry a Content-Security-Policy header. For every uncached, origin generated HTML response the header shall include, at minimum: `default-src 'self'`, `script-src 'self' 'nonce-<per-request>'` (no `unsafe-inline`, no `unsafe-eval`), `style-src 'self' 'nonce-<per-request>'`, `img-src 'self' data:` (as tight as asset strategy allows), `media-src 'self'`, `connect-src 'self' https://api.pwnedpasswords.com https://challenges.cloudflare.com`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, `upgrade-insecure-requests`. The cacheable word page shell (SDD decision B2) is a shared, edge cached response and cannot carry a genuine per request nonce, because a nonce baked into a shared cached response would be identical for every viewer for the cache lifetime, which does not satisfy the intended per-response nonce property and weakens nonce-based injection protection. The word page shell shall therefore contain no inline `<script>` or `<style>` and shall load all script and style from `'self'` origins, and its CSP header shall carry the same directive set with the nonce sources removed from `script-src` and `style-src` (`script-src 'self'`, `style-src 'self'`), which preserves the no `unsafe-inline` and no `unsafe-eval` guarantee without relying on a shared static nonce. A per request nonce shall never be reused across responses or served from cache.

**Rationale:** Foundational Decisions §2 — CSP with nonces, no `unsafe-inline`. Per ASVS v5.0.0-3.4.6, the CSP `frame-ancestors` directive is the required mechanism for clickjacking protection; the `X-Frame-Options` header is treated by the standard as obsolete and not relied upon.

**Acceptance criteria:**
- On every uncached HTML response, an inline `<script>` or `<style>` without a valid per request nonce fails to execute in the browser.
- The cacheable word page shell contains no inline `<script>` or `<style>`, and its CSP header carries `script-src 'self'` and `style-src 'self'` with no nonce source; no nonce value is served from cache or reused across responses.
- A Playwright test asserts the presence of every listed directive on `/`, `/en-us/cupcake`, `/en-us/learnIPA`, `/learnIPA`, `/register`, `/login`, `/settings`, `/privacy`, `/kvkk`, asserting a per request nonce source on the uncached responses and the nonce free equivalent (`script-src 'self'`, `style-src 'self'`) on the cacheable word page shell.
- The CSP violation report endpoint (if used) is `report-to`- or `report-uri`-configured and receives violations in staging tests.

#### NFR-SEC-04 — HTTP security headers. *Priority: Must.*

Responses shall include, in addition to CSP (NFR-SEC-03) and HSTS (NFR-SEC-02): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling at least `camera`, `microphone`, `geolocation`, `payment`, `usb`, `interest-cohort`, and `Cross-Origin-Opener-Policy: same-origin`. These shall be applied via Helmet middleware or equivalent, with any project-specific additions configured in one place.

**Rationale:** The Permissions-Policy explicitly turning `microphone` off is defence-in-depth against any future code path mistakenly requesting it — the whole v1.0 design refuses microphone use (FR-PRACTICE-03).

**Acceptance criteria:**
- Every HTML response's header set is verified by an integration test that fails on any missing header.
- `Permissions-Policy` explicitly denies `microphone`; a test confirms `navigator.mediaDevices.getUserMedia` is blocked by policy.

#### NFR-SEC-05 — Subresource Integrity on third-party assets. *Priority: Must.*

Any `<script>` or `<link rel="stylesheet">` whose `src`/`href` points outside the origin's own static host shall carry a valid `integrity` attribute with a SHA-384 (or stronger) digest and `crossorigin="anonymous"`. In v1.0 the only planned third-party origins are Cloudflare Turnstile and Google (for OAuth); if either cannot serve SRI-compatible assets, the dependency's integration strategy (e.g. Turnstile's widget loader) shall be reviewed and documented in the Threat Model.

**Acceptance criteria:**
- Grep of rendered HTML across all public routes reveals no cross-origin script/stylesheet tag without an `integrity` attribute, or an explicit Threat-Model-referenced exception.

#### NFR-SEC-06 — Secret management. *Priority: Must.*

Secrets (database credentials, session signing keys, OAuth client secrets, Turnstile secret, transactional-email API keys, HIBP API key if required, Sentry DSN) shall be supplied via environment variables loaded through dotenv. The repository shall contain a `.env.example` file listing every required variable with placeholder values and a one-line description. No real secret value shall ever be committed to version control. `.env` is `.gitignore`d.

**Rationale:** Handoff — dotenv for secrets. Public repo on GitHub from day one → every commit is publicly auditable.

**Acceptance criteria:**
- `git log -p` across the repository produces zero results for any production secret value (automated check with a secret-scanner in CI).
- A fresh clone + `cp .env.example .env` + filling dev values is sufficient to run the app locally.
- CI includes `trufflehog`, `gitleaks`, or GitHub's secret-scanning equivalent.

#### NFR-SEC-07 — Parameterised queries only. *Priority: Must.*

All SQL issued by application code shall use parameterised statements or an ORM that itself parameterises. String concatenation of user-controlled values into SQL is prohibited. This applies to every database access path, including seed scripts and the deletion worker.

**Rationale:** OWASP Top 10 A03 (Injection). ASVS v5.0.0-1.2.4 (parameterised database queries / ORMs / equivalent injection protection).

**Acceptance criteria:**
- A static-analysis lint rule (e.g. custom ESLint rule, or `eslint-plugin-security`) flags concatenated SQL and is part of the `npm run lint` gate.
- Code review checklist includes the item.

#### NFR-SEC-08 — Dependency scanning in CI. *Priority: Must.*

The CI pipeline shall run `npm audit --audit-level=high` on every push and fail the build on any High or Critical advisory against a production (non-dev) dependency. A Dependabot (or equivalent) configuration opens PRs for minor/patch updates automatically.

**Rationale:** Charter §4 item 5.

**Acceptance criteria:**
- CI's audit step is observable as a required status check on the default branch.
- A deliberate introduction of a known-vulnerable package version fails the pipeline in a rehearsal test.

#### NFR-SEC-09 — Pre-launch OWASP ZAP baseline scan. *Priority: Must.*

Before v1.0 launch the system shall undergo an OWASP ZAP baseline scan against the staging deployment. The scan's findings shall be triaged such that: no High-severity finding remains unresolved; every Medium-severity finding is either remediated or documented in the Risk Register with an explicit acceptance and mitigation. The scan report is archived in the repo under `docs/security/`.

**Rationale:** Charter Success Criterion 4.

**Acceptance criteria:**
- The archived scan report shows zero open Highs.
- Every open Medium has a Risk Register entry ID in its annotation.

#### NFR-SEC-10 — Logging hygiene. *Priority: Must.*

Application, access, and error logs shall never contain: passwords (plaintext or hashed), session tokens, CSRF tokens, password-reset tokens, email-verification tokens, OAuth access or refresh tokens, idempotency keys tied to auth flows, HIBP k-anonymity query content, complete email addresses outside the unambiguously safe "account audit" trail (which is itself restricted and rotated). IP addresses are logged in access logs only and retained for the retention window in NFR-OPS-04.

**Rationale:** ASVS v5.0.0-16.2.5 (logging based on data protection level — credentials, payment data, and similar must not appear in logs; session-token-class data may only be logged hashed or masked). A leaked log is a full credential dump if these fields slip in.

**Acceptance criteria:**
- A CI-run log-scraper test submits a known password through the login endpoint in a dev-mode run and greps the resulting log files for that password; the test fails if any match is found.
- The logging middleware sanitises request bodies on `POST /login`, `POST /register`, `POST /reset-password`, `POST /verify-email/*` to drop the password / token fields.

#### NFR-SEC-11 — Rate-limit enforcement infrastructure. *Priority: Must.*

Rate-limit counters (per Foundational Decisions §10.3 and referenced by FR-AUTH-15, FR-WORD-05, FR-SAVE-08's parent bucket, and others) shall be stored in Redis in the staging and production environments. In-memory counters are permitted for local development only. The Redis deployment is part of the Docker Compose topology and its data is non-persistent (counters are ephemeral; loss of Redis data at most resets limits).

**Rationale:** Foundational Decisions §2 explicitly calls out Redis as the rate-limit store to survive multi-instance Express scaling behind Nginx.

**Acceptance criteria:**
- The production container topology in the Deployment Diagram includes a Redis service.
- Rate-limit middleware is configured with a Redis store reference in the production env; unit tests confirm the middleware refuses to start under production `NODE_ENV` without a Redis connection.

#### NFR-SEC-12 — Cryptographically-strong token generation. *Priority: Must.*

Every random identifier or token generated by the application — anonymous-profile cookie identifiers, session IDs, CSRF tokens, password-reset tokens, email-verification tokens, idempotency keys (server-side), deletion IDs used in audit tombstones — shall be generated from a cryptographically secure PRNG (`crypto.randomBytes` in Node.js, or equivalent) with at least 128 bits of entropy. `crypto.randomUUID` (and other RFC 4122 UUID v4 generators) is not acceptable because it provides only 122 bits of entropy after the version and variant bits are fixed, below the floor required by ASVS v5.0.0-11.5.1. `Math.random()` is prohibited for any security-relevant value.

**Acceptance criteria:**
- Code search for `Math.random()` in security-sensitive modules returns zero hits.
- Unit tests sample 10 000 generated tokens and confirm no duplicates (birthday-bound for 128 bits).

### 5.2 Performance — `NFR-PERF-*`

#### NFR-PERF-01 — Core Web Vitals "Good" floor. *Priority: Must.*

Every public page shall meet Core Web Vitals thresholds in the "Good" range: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms, measured on a 4G throttled profile on the 2022+ evergreen baseline. Pages in scope: `/`, `/:variant/:word`, `/:variant/learnIPA`, `/learnIPA`, `/register`, `/login`, `/settings`, `/privacy`, `/kvkk`, `/practice`, the 404 word page.

**Rationale:** Foundational Decisions §4.

**Acceptance criteria:**
- A Lighthouse CI (or equivalent) run in the CI pipeline records CWV per page and fails the build on any page missing a "Good" threshold.
- Synthetic field-data reports generated monthly from real users (via `web-vitals` beacon, aggregated anonymously without per-user tracking) are reviewed by the maintainer.

#### NFR-PERF-02 — Word page LCP stretch target. *Priority: Should.*

Word pages (`/:variant/:word`) shall target an LCP of ≤ 1.5 s on the same measurement conditions as NFR-PERF-01. Missing the stretch target is not a launch blocker but is tracked as a performance debt item.

**Rationale:** Word pages are essentially static; a ≤ 1.5 s LCP reflects the product's minimalism and is achievable without exotic optimisation.

#### NFR-PERF-03 — Lighthouse category scores. *Priority: Must.*

Lighthouse scores in all four categories (Performance, Accessibility, Best Practices, SEO) shall be ≥ 90 on every page listed in NFR-PERF-01, measured with Lighthouse's default mobile profile. Charter Success Criterion 4.

**Acceptance criteria:**
- The CI-run Lighthouse suite records ≥ 90 per category per page.
- A scorecard artifact is attached to every CI run on the default branch.

#### NFR-PERF-04 — Server time-to-first-byte budget. *Priority: Should.*

The application tier shall produce a first byte of response within 200 ms (p95) for cached word pages and within 400 ms (p95) for uncached word pages, measured at the origin (Nginx) under expected v1.0 load (see NFR-PERF-08).

**Rationale:** Cloudflare edge caching will mask origin variability for most readers; the origin budget still matters for the first fetch of each word. The budget is set to catch performance regressions of roughly 100 ms and up — a missing index, a synchronous external call, an N+1 query — before they accumulate, while leaving headroom for legitimate variation. "At origin" means measured at the VPS, not at the user; user-perceived latency is governed by the Core Web Vitals floor in NFR-PERF-01.

**Acceptance criteria:**
- Synthetic RUM from the k6 load test reports p95 origin TTFB within the budget under the test load.
- A probe from a neutral region (e.g. Frankfurt if origin is Nuremberg) is run monthly.

#### NFR-PERF-05 — Database query budget on word-page composition. *Priority: Should.*

Composing the cacheable word-page shell (word + pronunciations + phoneme joins) shall complete in ≤ 50 ms (p95) against a database loaded with the launch dataset. Per-viewer save state and the progress banner count are served by the separate client-side hydration endpoint (see SDD) and are measured separately; this NFR sets no numeric budget for that endpoint. The query plan shall be reviewed in the SDD and relevant indexes declared in the ERD.

**Acceptance criteria:**
- An instrumented integration test measures total DB time for composing the shell of `/en-us/cupcake` and asserts the budget.

#### NFR-PERF-06 — Phoneme audio latency. *Priority: Must.*

Phoneme audio playback latency from click to audible playback shall meet the target defined in FR-IPA-04. This NFR exists to locate the performance-budget statement alongside the other performance targets; the normative source is FR-IPA-04.

#### NFR-PERF-07 — Page weight budget (HTML + critical CSS + core JS). *Priority: Should.*

Each word page's initial document (HTML) plus its critical CSS and core JavaScript shall be ≤ 150 KB gzipped, excluding audio and fonts. Both the `/learnIPA` page and the `/:variant/learnIPA` page have a budget of ≤ 200 KB under the same exclusions. Budgets are enforced by a size-limit check in the CI pipeline.

**Rationale:** The strongest single lever on LCP, INP, and "Best Practices" audits alike.

**Acceptance criteria:**
- `size-limit` (or equivalent) is configured and the CI step fails if any bundle exceeds its budget.

#### NFR-PERF-08 — Pre-launch load test. *Priority: Must.*

Before v1.0 launch the system shall sustain, for 10 minutes, a load profile of 200 concurrent anonymous visitors each paging through 5 word pages per minute, plus 20 concurrent logged-in users each running one practice session, without exceeding: origin CPU 70 %, origin memory 70 % of allocated, error rate 0.5 %, p95 origin TTFB per NFR-PERF-04.

**Rationale:** Charter §5 — hardening includes load testing. The 200-plus-20 profile gives a realistic rough-launch margin: an AGPL open-source project can attract sudden traffic spikes from Hacker News, Reddit, or developer communities at launch, and the earlier 50-plus-5 profile was too modest to reflect that. Cloudflare absorbs burst above this; the tooling choice (k6 or equivalent) is deferred to the Test Plan.

**Acceptance criteria:**
- A k6 script lives in the repo and is runnable against staging with a single command.
- The launch checklist in the Runbook includes a signed-off load-test report.

### 5.3 Accessibility — `NFR-A11Y-*`

#### NFR-A11Y-01 — WCAG 2.2 Level AA compliance. *Priority: Must.*

Every public page shall conform to WCAG 2.2 Level AA. Conformance is evidenced by (a) zero axe-core violations of A or AA rules covering the WCAG 2.2 ruleset, and (b) manual review against the Level AA criteria that axe-core cannot verify automatically (contrast in generated imagery, keyboard-only task completion, screen-reader comprehension of the save control and the practice session, and the new 2.2 criteria where automated checks are partial — focus-not-obscured, target size, redundant entry).

**Rationale:** Charter Success Criterion 4. WCAG 2.2 (October 2023) is the current W3C Recommendation and is also published as ISO/IEC 40500:2025; the project targets it directly rather than the prior 2.1 baseline. The new AA criteria added in 2.2 are elaborated where appropriate in NFR-A11Y-11 through NFR-A11Y-14.

**Acceptance criteria:**
- The CI Playwright + axe-core run uses a ruleset configured for WCAG 2.2 (axe-core's `wcag22aa` tag) and reports zero violations on the NFR-PERF-01 page list.
- A manual review checklist is in `docs/a11y/` and is dated and signed before launch. The checklist explicitly covers each new 2.2 AA criterion: 2.4.11 (Focus Not Obscured), 2.5.7 (Dragging Movements — N/A justification recorded), 2.5.8 (Target Size), 3.3.8 (Accessible Authentication).

#### NFR-A11Y-02 — Lighthouse Accessibility score. *Priority: Must.*

Lighthouse Accessibility score shall be ≥ 90 on every NFR-PERF-01 page. NFR-PERF-03 carries the shared ≥ 90 requirement; NFR-A11Y-02 is its accessibility-specific restatement to ease traceability.

#### NFR-A11Y-03 — Keyboard operability. *Priority: Must.*

Every interactive control — IPA phoneme elements, save/tag buttons, popover controls, practice assessment buttons, navigation, forms — shall be fully operable with the keyboard alone. Tab order shall be logical (top-to-bottom, left-to-right in document order, with any explicit `tabindex` overrides justified in a code comment). No interaction shall be reachable only via hover or via pointer-specific gestures.

**Acceptance criteria:**
- A Playwright test drives `/en-us/cupcake` end-to-end with keyboard only: navigating to a phoneme, activating it, interacting with the popover, saving, tagging `learning`.
- The same test runs on `/practice` for the self-assessment loop.

#### NFR-A11Y-04 — Focus management. *Priority: Must.*

The phoneme popover, the save-tag popover, and any modal shall: receive focus on open, trap focus for the duration of their visibility, return focus to the invoking element on close, and be dismissible with `Esc`. Non-modal overlays (cookie banner, open-source banner, registration nudge) shall not trap focus but shall be reachable in tab order.

**Acceptance criteria:**
- Playwright test with keyboard focus tracer verifies open/trap/return for each named popover.
- `Esc` dismisses each popover in a test.

#### NFR-A11Y-05 — Colour contrast. *Priority: Must.*

Text and meaningful non-text UI shall meet WCAG 2.2 contrast thresholds: 4.5:1 for normal text, 3.0:1 for large text (≥ 18 pt or ≥ 14 pt bold) and for graphical components conveying state. The saved/learning/learned colour distinctions (if colour-encoded) shall additionally be distinguishable without colour (e.g. different icon shapes, per FR-SAVE-01's `aria-pressed`/`aria-label`).

**Acceptance criteria:**
- axe-core's colour-contrast rule reports zero failures.
- A manual check in greyscale rendering confirms state distinctions remain perceivable.

#### NFR-A11Y-06 — Screen-reader semantics for save state. *Priority: Must.*

The save control shall expose, via ARIA, its current state (`aria-pressed="true"` when saved, `aria-pressed="false"` when unsaved) and an accessible name that includes the state and the target (e.g. "Saved as learning: cupcake", "Unsaved: /k/"). State changes shall be announced in an `aria-live="polite"` region.

**Rationale:** FR-SAVE-01's acceptance criteria call for accessible announcement; this NFR fixes the mechanism.

**Acceptance criteria:**
- A screen-reader snapshot test (NVDA + Chrome, VoiceOver + Safari) confirms announcements on save, tag, unsave.

#### NFR-A11Y-07 — Reduced motion. *Priority: Must.*

Any animation longer than 200 ms or involving translation larger than 20 CSS px shall be suppressed or shortened when `prefers-reduced-motion: reduce` is set. In particular, the popover open/close and any practice-session transitions respect the preference.

**Acceptance criteria:**
- CSS is guarded by `@media (prefers-reduced-motion: reduce)` for every such animation.
- A Playwright test with the emulated preference confirms animations are suppressed or ≤ 200 ms.

#### NFR-A11Y-08 — Text resize to 200 %. *Priority: Must.*

With the browser font-size scaled to 200 %, every NFR-PERF-01 page shall remain usable: no content clipping, no loss of interactivity, horizontal scrolling only where the viewport is genuinely narrower than a single word line. No layout breakage.

**Acceptance criteria:**
- Playwright tests at 200 % font size on 320, 768, and 1440 px viewports confirm no overflow beyond the documented single-word-line exception.

#### NFR-A11Y-09 — Language attribute. *Priority: Must.*

Every HTML response shall include a `lang` attribute on `<html>`. English pages use `lang="en"`; the KVKK page (FR-CONSENT-05) uses `lang="tr"`. Any embedded fragment in a different language (e.g. an IPA string annotated as International Phonetic Alphabet) uses `lang` appropriately on its element; IPA is treated as `lang` unset or `lang="und"` depending on consensus recorded in the SDD.

**Acceptance criteria:**
- An axe-core run asserts `html[lang]` presence and correctness.

#### NFR-A11Y-10 — Accessible names for IPA phoneme elements. *Priority: Must.*

Every clickable IPA phoneme element shall expose an `aria-label` that names the phoneme in a way screen-reader users can understand (e.g. `aria-label="Phoneme /k/ — the k sound as in cat"`). Visual-only IPA symbols without an accessible name are not acceptable.

**Rationale:** A lone IPA symbol is opaque to a user who cannot see it; naming gives the interaction meaning.

**Acceptance criteria:**
- An axe-core rule plus a unit test per phoneme assert the presence and structure of the `aria-label`.

#### NFR-A11Y-11 — Touch target size for standalone interactive controls. *Priority: Must.*

Every standalone interactive control — save button, tag-state controls, practice-session "right"/"wrong" buttons, audio-play buttons (whole-word and per-phoneme), navigation links, form submit buttons, popover dismiss buttons — shall have a target size of at least 24 × 24 CSS pixels, OR be spaced such that a 24 CSS pixel diameter circle centered on the control's bounding box does not intersect another target. Inline IPA phoneme symbols (rendered within IPA transcription text flow on the word page, FR-IPA-02) are exempt under the WCAG 2.2 §2.5.8 "Inline" exception because their size is constrained by the line-height of the surrounding non-target text.

**Rationale:** WCAG 2.2 success criterion 2.5.8 (Target Size, Minimum) at AA. Helps users with motor impairments, hand tremors, and any user on a touch device.

**Acceptance criteria:**
- A Playwright visual measurement test asserts ≥ 24 × 24 CSS px (or qualifying spacing) on every named control across the NFR-PERF-01 page list at the 320 px viewport width.
- A documented design rationale exists in `docs/a11y/` for any control invoking the Inline exception.

#### NFR-A11Y-12 — Focus indicator not obscured by author-created content. *Priority: Must.*

When any user-interface component receives keyboard focus, it shall not be entirely hidden by author-created content (cookie banner, open-source banner, sticky headers/footers, popovers). Partial obscuring is permitted at this level. Specifically: when the cookie banner (FR-CONSENT-01) or the open-source banner (FR-OSS-01) is visible, focus moving to controls in the lower portion of the viewport shall scroll the focused control into a visible region or shall not be entirely covered by the banner.

**Rationale:** WCAG 2.2 success criterion 2.4.11 (Focus Not Obscured, Minimum) at AA. Distinct from NFR-A11Y-04 (which covers focus trapping inside modal popovers); this NFR covers the scenario where non-modal page chrome obscures the focused control.

**Acceptance criteria:**
- A Playwright test tabs through every interactive control on a 320 × 568 px viewport with the cookie banner visible and the open-source banner visible, asserting at least partial visibility of the focus indicator on each.
- The same test is repeated with both banners dismissed.

#### NFR-A11Y-13 — No redundant entry in multi-step processes. *Priority: Must.*

Information previously entered by or provided to the user within the same multi-step process (registration including username collection, email-verification, password-reset, account deletion confirmation) shall be auto-populated or available for selection in subsequent steps. Re-entry is permitted only where (a) re-entering is essential to the security of the action (e.g., password re-entry to confirm account deletion per Foundational Decisions §8), (b) the information is required to ensure security of the content, or (c) the previously-entered information is no longer valid.

**Rationale:** WCAG 2.2 success criterion 3.3.7 (Redundant Entry) at A level. Reduces cognitive load for all users and removes a barrier for users with cognitive disabilities or memory impairments.

**Acceptance criteria:**
- The registration → username collection → email-verification flow does not re-prompt for the email address.
- The password-reset flow does not require the user to re-enter their email after the reset token has been validated.
- The account-deletion flow's password re-entry (Foundational Decisions §8) is documented as an essential security exception in `docs/a11y/`.

#### NFR-A11Y-14 — Accessible authentication: cognitive-test-free path available. *Priority: Must.*

Authentication shall not require a cognitive function test (such as memorizing a password or solving a puzzle) without providing at least one of the following alongside it: (a) an alternative authentication method that does not rely on a cognitive function test, or (b) a mechanism to assist the user in completing the cognitive function test. The system meets this requirement via two independent means: (1) Google OAuth (Foundational Decisions §7) provides an authentication path that does not require recalling a password; (2) password input fields shall accept paste operations and shall not disable autofill from password managers, providing a mechanism to assist users with the cognitive task of typing a password from memory.

**Rationale:** WCAG 2.2 success criterion 3.3.8 (Accessible Authentication, Minimum) at AA. Cloudflare Turnstile (Foundational Decisions §9) is also designed to avoid cognitive function tests (no image puzzles), aligning with this criterion as a side benefit.

**Acceptance criteria:**
- A Playwright test confirms paste is permitted in every password field (`#password` on `/register`, `/login`, `/reset-password/finish`).
- A Playwright test confirms `autocomplete="current-password"` (login) and `autocomplete="new-password"` (register, reset) are present on the relevant inputs.
- The Google OAuth path is reachable from `/register` and `/login` without first requiring password entry.

### 5.4 Privacy — `NFR-PRIV-*`

#### NFR-PRIV-01 — Data minimisation. *Priority: Must.*

The system shall collect only the personal data enumerated in Appendix E (PII field inventory). Any proposal to collect a field not listed in Appendix E shall require an update to the Privacy Policy, the Cookie Table, the Threat Model, and this appendix before implementation.

**Rationale:** GDPR Art. 5(1)(c); Charter §4 item 6.

**Acceptance criteria:**
- Every field in Appendix E maps to exactly one FR that justifies collection; fields without an FR pointer are removed.
- A code review gate for schema changes rejects new `users`/`user_accounts` columns that contain PII unless Appendix E is updated in the same PR.

#### NFR-PRIV-02 — Retention periods. *Priority: Must.*

Retention periods shall be:

| Data class | Retention | Rationale |
|-----------|-----------|-----------|
| Event log rows owned by a registered user | Until the user deletes the account | It is the user's own progress data |
| Event log rows owned by an *unbound* anonymous UUID | **Pruned when the UUID has been dormant for 2 years** (matches the cookie's max sliding lifetime) | GDPR Art. 5(1)(e) storage limitation |
| Anonymous-to-account bindings (`identity_bindings`) and the events of a *bound* anonymous UUID | Follow the account lifecycle; deleted on account hard-delete, never dormancy-pruned | The identity belongs to an active account, so storage limitation is governed by the account, not by anonymous dormancy |
| Session rows (`pa_sid`) | Idle 30 min / absolute 12 h (per FR-AUTH-12), pruned nightly | Per Foundational Decisions §2 |
| Email-verification tokens | 24 h (per FR-AUTH-09), pruned nightly after expiry | Security |
| Password-reset tokens | 1 h (per FR-AUTH-11), pruned nightly after expiry | Security |
| Soft-deleted accounts | 30 days (per FR-SET-07), then hard-deleted | Foundational Decisions §8 |
| Access logs (at Cloudflare + origin) | 30 days | Ops troubleshooting without over-retention |
| Application logs (origin) | 90 days at launch → 30 days once incident frequency stabilises | NFR-OPS-04 |
| Backups | Daily × 30 days + weekly × 26 weeks; RPO ≤ 24 h | NFR-OPS-01 |
| Consent records | Retained as long as the account exists; deleted with hard-delete | GDPR Art. 7(1) demonstrability |
| Deletion-audit tombstones (no PII) | Retained indefinitely | Audit |

**Rationale:** GDPR Art. 5(1)(e). The 2-year anonymous dormancy figure matches the `pa_uid` cookie's maximum sliding lifetime (Foundational Decisions §6): a browser that has forgotten its cookie cannot rejoin its old anonymous profile, so retaining the data longer yields no privacy or UX benefit. The figure may be tuned downward without harm if the dormant tail of the profile table grows large.

**Acceptance criteria:**
- A scheduled pruning job exists and is documented in the Runbook for each row of the table.
- A dry-run of the pruning job against a synthetic dataset (seeded to exercise every expiry boundary) produces the expected deletions.

#### NFR-PRIV-03 — Right-to-erasure response time. *Priority: Must.*

Hard-delete execution shall complete within 24 hours of user confirmation (FR-SET-08). Soft-delete transition is immediate; the automatic hard-delete at the 30-day boundary shall also complete within 24 hours of that boundary being crossed.

**Rationale:** GDPR Art. 17 expects "undue delay" erasure. 24 h is a practical operational boundary for a scheduled worker.

**Acceptance criteria:**
- The deletion worker's schedule and observed completion times are reported in the operational log summary reviewed by the maintainer.

#### NFR-PRIV-04 — Data-subject access request response time. *Priority: Must.*

A data-subject access request (GDPR Art. 15 / KVKK Art. 11) shall be acknowledged within 3 business days of receipt at the contact address in the Privacy Policy and fulfilled within 30 days, as required by GDPR Art. 12(3). If complex, the deadline may extend by up to 60 days with written notice to the subject.

**Rationale:** Statutory requirement.

**Acceptance criteria:**
- The Privacy Policy lists the contact address and the response-time commitment.
- The Runbook contains a documented DSAR procedure (identity verification, data export from the running DB, redaction of other users' data, delivery channel).

#### NFR-PRIV-05 — No third-party trackers by default. *Priority: Must.*

Without an explicit opt-in (FR-SET-04), the served pages shall load no third-party resource that sets a cross-site tracking identifier. Permitted third-party origins for default loads are: Cloudflare (edge + Turnstile widget — Turnstile sets no cross-site tracker per its documentation), Google (only on `/login` during an OAuth flow the user initiates), `api.pwnedpasswords.com` (only during password choice, and with the k-anonymity prefix protocol of FR-AUTH-07).

**Rationale:** Charter §4 item 6; Foundational Decisions throughout.

**Acceptance criteria:**
- A Playwright network-log test on `/` and every NFR-PERF-01 page confirms no request to ad, analytics, or tracking domains.
- A separate test confirms the Google network request only fires after the user clicks "Continue with Google" on `/login`.

#### NFR-PRIV-06 — Third-party data-flow inventory. *Priority: Must.*

The Threat Model shall include a data-flow diagram listing every third party the system exchanges personal data with and what is exchanged: Google OAuth (email, subject identifier, profile picture URL on login), Cloudflare edge (IP, request metadata, Turnstile token payload), HIBP (SHA-1 prefix only, the first five hex characters, under k anonymity), the transactional email provider (recipient email address and token URL), and the off-site backup provider (Backblaze B2 per SDD decision V6), which stores an encrypted logical database backup containing personal data. The error-tracking service (Sentry or equivalent per NFR-OPS-03) receives exception and 5xx diagnostics with named user PII scrubbed before transmission; whether any residual metadata it transmits qualifies as personal data is determined in the Threat Model. No other intentional personal-data flow shall leave the origin. If the Threat Model determines the error-tracking service transmits residual personal data, that service shall be added to this inventory, the Privacy Policy, and the Threat Model before production use.

**Acceptance criteria:**
- The Threat Model's DFD enumerates every confirmed personal-data recipient named above and records the error-tracking service's residual-metadata determination.
- Any change to the list requires an update here, in the Privacy Policy, and in the Threat Model in the same PR.

### 5.5 Operations — `NFR-OPS-*`

#### NFR-OPS-01 — Automated backups. *Priority: Must.*

MySQL shall be backed up by a nightly `mysqldump` (logical backup) with gzip compression, pushed to off-site object storage (S3-compatible) with server-side encryption. Retention: daily snapshots for 30 days and weekly snapshots for 26 weeks; the recovery point objective (RPO) is up to 24 hours, matching the daily backup interval. The backup job's failure shall page the maintainer.

**Rationale:** Charter §5 (hardening includes automated backups). Off-site storage for a launch-scale dataset costs cents per month, so the daily-plus-weekly scheme is the standard disaster-recovery balance: daily snapshots cover fast-recovery scenarios (restore last night, lose ≤ 24 h) and weekly snapshots cover slow-corruption scenarios (a bug found weeks later). A tighter RPO would require continuous binlog streaming, which is out of scope for v1.0.

**Acceptance criteria:**
- A backup row is produced every night and the file is observable in the off-site bucket.
- Backup-job failure notifications route to the maintainer's contact.

#### NFR-OPS-02 — Quarterly restore test. *Priority: Must.*

Once per calendar quarter the maintainer shall perform a documented restore of the most recent backup into a scratch database, verify row counts against the live primary, and spot-check a sample of word pages. The test's outcome is logged in `docs/ops/restore-tests.md`.

**Rationale:** A backup whose restore has never been verified is not a backup.

**Acceptance criteria:**
- The log file has at least one entry per quarter after launch.

#### NFR-OPS-03 — Error tracking. *Priority: Must.*

Unhandled exceptions and 5xx-class responses from the Express app shall be reported to Sentry (or an equivalent error-tracking service on a privacy-respecting free tier). User PII (names, emails, passwords, tokens) shall be scrubbed before transmission by the tracker's client configuration.

**Rationale:** Charter §5 — error tracking is part of hardening.

**Acceptance criteria:**
- An integration test throws a controlled error in a staging environment; the error appears in the tracking dashboard within 60 s without any PII field.

#### NFR-OPS-04 — Log retention and privacy. *Priority: Must.*

Origin application logs shall be retained for 90 days at v1.0 launch. Post-launch milestone: once the maintainer judges that incident frequency has stabilised, application-log retention is reduced to 30 days. Access logs shall be retained for 30 days. Logs shall never be stored beyond their window for any non-security reason. Security-relevant incident logs may be retained longer when tied to a specific investigation; such retention is documented in the Runbook per incident.

**Rationale:** GDPR storage limitation balanced against operational needs. The first weeks and months after launch are when most operational issues surface, so 90 days of application-log history keeps investigation of a bug reported "last month" feasible; once the system is stable, 30 days suffices and reduces both storage cost and storage-limitation exposure. The reduction is a maintainer decision tracked in the Runbook, not a calendar trigger.

#### NFR-OPS-05 — Reproducible deployment. *Priority: Must.*

A fresh Hetzner VPS with the documented OS image shall be bootstrapable into a running PronounceAll production host by following the Runbook's deployment procedure, which consists solely of shell commands and the repo itself. No undocumented manual step shall be required.

**Rationale:** Solo-dev operability — any step that exists only in the maintainer's head is an availability risk.

**Acceptance criteria:**
- Dry-run rehearsal on a throwaway VPS before launch succeeds without deviation from the Runbook.
- The rehearsal is repeated after any non-trivial infrastructure change.

#### NFR-OPS-06 — Availability target. *Priority: Should.*

PronounceAll v1.0 is provided on a **best-effort basis with no contractual service-level agreement**. The project aspires to 99 % monthly availability as an internal goal, not a commitment. The maintainer commits to acknowledging outages within 24 hours of awareness and restoring service as fast as reasonably possible. Outages may occur due to upstream dependencies (hosting, CDN, certificate authority) or maintainer availability; known-maintenance windows are announced via the GitHub repository's issue tracker.

**Rationale:** A free, solo-maintained, AGPL project must not promise 99.9 %, which would require monitoring, paging, and on-call response an unpaid solo maintainer cannot sustain. Any availability figure above the floor of (hosting uptime × CDN uptime × certificate-renewal reliability) is fictional, so a best-effort posture with a stated 99 % aspiration is the honest framing for v1.0.

**Acceptance criteria:**
- The Privacy Policy, README, and Settings page do not promise any SLA.
- The project's status is communicable via a lightweight mechanism (GitHub Issues or a status badge) when outages occur.

#### NFR-OPS-07 — Health check. *Priority: Must.*

The application shall expose an unauthenticated `GET /healthz` endpoint that returns HTTP 200 when the application is able to: (a) reach the database, (b) reach Redis, (c) read one row from `language_variants`. The response body is minimal JSON (`{"status":"ok","db":"ok","redis":"ok"}` or a failure variant). The endpoint shall not be linked from the UI, shall be rate-limited (higher limit than user flows, per the edge WAF), and shall not expose version or build information beyond what is already in the HTTP response headers.

**Acceptance criteria:**
- Cloudflare's uptime monitor is configured to probe `/healthz`.
- A deliberate DB outage flips the endpoint to HTTP 503 in an integration test.

#### NFR-OPS-08 — CI pipeline on every push. *Priority: Must.*

CI (GitHub Actions) shall run on every push to any branch and every pull request against the default branch. Jobs: lint (ESLint), unit + integration tests (Jest + Supertest), end-to-end tests (Playwright), dependency audit (NFR-SEC-08), secret scan (NFR-SEC-06), Lighthouse CI (NFR-PERF-03 + NFR-A11Y-02), size-limit (NFR-PERF-07). Merge to the default branch is gated on all jobs passing.

**Rationale:** Handoff fixes CI on every push.

**Acceptance criteria:**
- Branch-protection rules on the default branch enumerate all listed checks as required.
- A deliberate lint failure in a PR is caught and blocks merge.

### 5.6 Compatibility — `NFR-COMPAT-*`

#### NFR-COMPAT-01 — Browser baseline. *Priority: Must.*

The application's interactive features shall function correctly on the last two stable major releases of Chrome, Firefox, Safari, and Edge as of the launch month, consistent with Foundational Decisions §5's "2022+ evergreens" floor.

**Acceptance criteria:**
- Playwright E2E runs against all four browsers in CI (where Playwright provides them) pass.
- Safari-specific coverage is handled via `webkit` in Playwright.

#### NFR-COMPAT-02 — Viewport range. *Priority: Must.*

Every public page shall render and remain interactive across viewport widths 320 px–1920 px and heights ≥ 568 px (iPhone SE). Horizontal scrolling is permitted only where a single line of content genuinely exceeds the narrowest width (cf. NFR-A11Y-08).

**Acceptance criteria:**
- See FR-WORD-07 and NFR-A11Y-08 acceptance criteria.

#### NFR-COMPAT-03 — Progressive enhancement. *Priority: Must.*

Word pages shall be readable (meaning + IPA text + syllable breakdown) with JavaScript disabled. Interactive features (phoneme click-to-play, save popover, practice session) may require JavaScript and shall fail gracefully — defined in FR-IPA-05 (audio falls back to native `<audio controls>` without JS), FR-SAVE-07 (save control degrades to form POST), FR-WORD-06 (progress banner renders in static form).

**Acceptance criteria:**
- NoScript-profile Playwright tests across FR-WORD-08, FR-IPA-05 fallback, FR-SAVE-07 pass.

#### NFR-COMPAT-04 — Input modality. *Priority: Must.*

Every interactive control shall be operable via at least two of {pointer, touch, keyboard}. No interaction is keyboard-only (excluding genuine keyboard affordances like `Esc` to close a popover) or pointer-hover-only. Touch targets are ≥ 44 × 44 CSS px (FR-WORD-07).

#### NFR-COMPAT-05 — CSS feature baseline. *Priority: Should.*

Allowed without fallback: Flexbox, CSS Grid (1D or simple 2D), `:has()`, `aspect-ratio`, custom properties, logical properties, `prefers-color-scheme`, `prefers-reduced-motion`. Avoid without graceful fallback: CSS Anchor Positioning, View Transitions API, Grid subgrid, container queries (allowed only if Flex/Grid falls back cleanly). New CSS features shipping after the 2022 baseline require justification in the PR description.

**Rationale:** Foundational Decisions §5.

### 5.7 Internationalisation — `NFR-I18N-*`

#### NFR-I18N-01 — UI language policy for v1.0. *Priority: Must.*

The user interface is English in v1.0. Turkish appears only on the two legal pages (`/privacy` in English, `/kvkk` in Turkish per FR-CONSENT-05). No i18n framework, no message catalogues, no locale-switcher outside the variant selector (which selects pronunciation variant, not UI language) ships in v1.0.

**Rationale:** Foundational Decisions §3.

#### NFR-I18N-02 — Character encoding. *Priority: Must.*

All text content shall be encoded as UTF-8 end-to-end. All text from user-supplied or dictionary-supplied input shall be normalised to Unicode NFC before storage and comparison. The database connection encoding, session encoding, HTTP `Content-Type` charset, and file-system encoding shall be UTF-8.

**Acceptance criteria:**
- Application startup logs confirm UTF-8 on the DB connection.
- IPA strings stored in the DB are byte-identical to their NFC-normalised form.

#### NFR-I18N-03 — IPA rendering. *Priority: Must.*

IPA symbols shall render correctly on every supported browser/OS pair, per FR-IPA-09. NFR-I18N-03 exists to locate the requirement alongside other internationalisation NFRs; the normative source is FR-IPA-09.

#### NFR-I18N-04 — Time-zone handling. *Priority: Must.*

All timestamps at rest (event log, session tables, sm2_states, scheduled jobs, audit rows) shall be stored in UTC. Human-facing timestamps (if any surface to the user in v1.0 — e.g. "your account is scheduled for deletion at X") shall be rendered in the viewer's local time zone using the `Intl.DateTimeFormat` API on the client; server-rendered fallbacks use UTC with an explicit "UTC" suffix.

**Rationale:** Storage of local times is a common source of subtle bugs when a site attracts users across time zones.

**Acceptance criteria:**
- Every `TIMESTAMP`/`DATETIME` column documented in the ERD is annotated as UTC.
- A Playwright test running with a simulated `Europe/Istanbul` timezone renders a sample timestamp correctly offset from UTC.

#### NFR-I18N-05 — i18n-ready hooks. *Priority: Should.*

The URL pattern `/:variant/:word` and the `language_variants` table structure shall permit adding a new variant (`en-gb`, `fr-fr`) as a data change plus a phoneme-table and dictionary-ingestion exercise, without a code refactor. UI strings that would later be translated shall be centralised in a single module per route (kept simple; no i18n framework) so a future contribution can wire in one.

**Rationale:** Charter and Handoff commit to multi-variant expansion post-v1.0; the seams should be designed now.

### 5.8 Legal & licensing — `NFR-LEGAL-*`

#### NFR-LEGAL-01 — GDPR compliance crosswalk. *Priority: Must.*

The Privacy Policy and supporting controls shall satisfy GDPR Articles 5 (principles), 6 (legal basis), 7 (consent), 12 (response times), 13 (information to be provided), 15 (access), 17 (erasure), 20 (portability — scoped to what v1.0 actually stores). The Threat Model shall include a crosswalk table mapping each article to the implementing FR, NFR, or process.

**Acceptance criteria:**
- The crosswalk table exists and every article row is populated.

#### NFR-LEGAL-02 — KVKK compliance. *Priority: Must.*

The KVKK *Aydınlatma Metni* (`/kvkk`) shall satisfy KVKK Articles 5 (lawful bases), 10 (obligation to inform), and 11 (data subject rights). Turkish wording shall be reviewed by someone with legal knowledge before launch (flagged in Handoff Open Questions).

#### NFR-LEGAL-03 — Code licence verbatim. *Priority: Must.*

The repository root shall contain a `LICENSE` file with the GNU AGPL-3.0 licence text verbatim. Every application source file shall include a minimal licence header or a `LICENSE-NOTICE.md` reference per the AGPL's recommended practice. Charter §7.

**Acceptance criteria:**
- The file SHA-256 matches the upstream FSF distribution of AGPL-3.0.
- A CI lint rule verifies the presence of a licence header (or `LICENSE-NOTICE.md` reference) in every `.js`, `.mjs`, `.cjs`, `.ejs` file.

#### NFR-LEGAL-04 — Content licence declaration. *Priority: Must.*

`README.md` shall state the content licence (CC BY-SA 4.0) and identify which parts of the repo are "content" (IPA example-word lists, documentation, maintainer-recorded audio). Dictionary data ingested from upstream sources retains upstream licensing, documented per-source.

#### NFR-LEGAL-05 — Upstream attribution on content pages. *Priority: Must.*

Every word page shall display the upstream dictionary source and its licence per FR-CONTENT-05. Every phoneme example word whose example sentence or audio is sourced from outside the project shall similarly display its attribution. The Runbook documents the attribution policy.

#### NFR-LEGAL-06 — Security policy. *Priority: Must.*

The repository shall contain `SECURITY.md` at root describing the vulnerability-reporting process (private channel, response SLA, coordinated disclosure window). Charter §9.

**Acceptance criteria:**
- `SECURITY.md` exists from Iteration 0 and is referenced from `README.md`.
- GitHub's "Security policy" tab auto-links the file.

#### NFR-LEGAL-07 — Code of conduct. *Priority: Must.*

The repository shall contain `CODE_OF_CONDUCT.md` with the Contributor Covenant 2.1 text verbatim and a contact for reports (maintainer's email). Charter §9.

#### NFR-LEGAL-08 — Change control alignment. *Priority: Must.*

Any change to vision, success criteria, scope, or licensing shall update the Project Charter, the Project Handoff Document, and the affected downstream documents (this SRS, SDD, ERD, API Spec, Threat Model, Privacy Policy, KVKK notice) in the same merge. Charter §10.

**Acceptance criteria:**
- A PR template includes a checklist item for downstream-document impact.

---

## 6. Traceability matrix

Columns:

- **ID** — requirement ID.
- **Charter SC** — Charter Success Criterion 1–6 (§4 of Charter), or "—" if the requirement maps to a supporting non-criterion goal.
- **Handoff** — Handoff section reference (F = Feature Brief, L = Launch Scope, D = Key Decisions, Open-Source Files, Principles) or "FD §N" for Foundational Decisions.
- **Test vehicle** — the test type(s) that will verify. Specific Test-Plan IDs are pending; populated in Round 4 after the Test Plan draft.
- **Threat Model** — "TM pending" for security-sensitive requirements; populated after the Threat Model is drafted.

### 6.1 Word pages

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-WORD-01 | 1 | F: Core concept and URL structure; D: URL pattern | Supertest, Playwright | TM pending (input validation) |
| FR-WORD-02 | — | F: Core concept; FD §2 (input handling) | Supertest | TM pending (input validation) |
| FR-WORD-03 | 1 | F: The word page | Supertest, Playwright | — |
| FR-WORD-04 | 1 | F: Core concept (404 UX) | Supertest, Playwright | — |
| FR-WORD-05 | — | F: Core concept; FD §10.3 (rate limit) | Supertest, Playwright | TM pending (abuse) |
| FR-WORD-06 | 1 | F: The IPA learning flow | Playwright | — |
| FR-WORD-07 | — | FD §5 (responsive) | Playwright | — |
| FR-WORD-08 | — | FD §5 (progressive enhancement) | Playwright (noScript) | — |
| FR-WORD-09 | 4 (SEO) | L: Hardening (SEO) | Lighthouse CI | — |
| FR-WORD-10 | 1 | L: Hardening (seed) | Manual + DB assertion | — |

### 6.2 IPA system

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-IPA-01 | 1 | F: The IPA learning flow | DB assertion, unit | — |
| FR-IPA-02 | 1 | F: The word page | Playwright, axe-core | — |
| FR-IPA-03 | 1 | F: The word page | Playwright | — |
| FR-IPA-04 | 1 | F: The word page (latency) | Playwright with perf probes | — |
| FR-IPA-05 | 1 | F: The word page (audio fallback) | Supertest + Playwright | — |
| FR-IPA-06 | 4 (perf) | FD §4 | Playwright + Lighthouse CI | — |
| FR-IPA-07 | 1 | F: The IPA learning flow | Supertest + Playwright | — |
| FR-IPA-08 | 1 | F: The word page (sound-not-spelling) | Unit (seed lint) + manual | — |
| FR-IPA-09 | 1 | — (robustness) | Playwright screenshot | — |
| FR-IPA-10 | 1 | — (Option B URL split, post-Handoff) | Supertest + Playwright | — |

### 6.3 Save & tag system

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-SAVE-01 | 2 | F: Saving words | Playwright, axe-core | — |
| FR-SAVE-02 | 2 | F: Saving words | Playwright, unit | — |
| FR-SAVE-03 | 2, 3 | F: Tracking users (merge basis) | DB assertion, unit | TM pending (audit trail) |
| FR-SAVE-04 | 2 | F: Tracking users (merge basis) | Unit (derivation script) | — |
| FR-SAVE-05 | 2 | F: Tracking users | Playwright (fresh profile) | — |
| FR-SAVE-06 | 6 | FD §6 (read-only fallback) | Playwright (no-cookies) | — |
| FR-SAVE-07 | — | FD §5 | Playwright (noScript) | — |
| FR-SAVE-08 | — | FD §2 (CSRF) | Supertest | TM pending (CSRF) |
| FR-SAVE-09 | — | F: Post-v1.0 analytics hook | Unit, DB assertion | — |

### 6.4 Practice sessions

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-PRACTICE-01 | 2 | F: Practice sessions | Supertest, Playwright | — |
| FR-PRACTICE-02 | 2 | F: Saving words (frequency) | Unit (seeded RNG) | — |
| FR-PRACTICE-03 | 2 | F: Practice sessions | Playwright | TM pending (no mic) |
| FR-PRACTICE-04 | 2 | D: SM-2 | Unit (algorithm coverage) | — |
| FR-PRACTICE-05 | 2 | F: Practice sessions | Unit (seeded RNG) | — |
| FR-PRACTICE-06 | 2 | — (operational hygiene) | Unit + Playwright | — |
| FR-PRACTICE-07 | — (OOS) | F: Post-v1.0 | — | — |

### 6.5 Authentication & account lifecycle

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-AUTH-01 | 2, 6 | FD §6 | Supertest, Playwright | TM pending (cookie tradeoff) |
| FR-AUTH-02 | 2 | FD §6 | Playwright | TM pending (localStorage surface) |
| FR-AUTH-03 | 6 | FD §6 (data minimisation) | DB assertion | — |
| FR-AUTH-04 | 3 | FD §7 | Supertest | — |
| FR-AUTH-05 | 3 | FD §7 | Supertest, unit | — |
| FR-AUTH-06 | 3 | FD §7 | Supertest | TM pending (enumeration) |
| FR-AUTH-07 | — | FD §2 | Supertest, unit, network trace | TM pending (HIBP flow) |
| FR-AUTH-08 | — | FD §2 | Unit + log inspection | TM pending (storage) |
| FR-AUTH-09 | 3 | FD §7 | Supertest, Playwright | TM pending (token lifecycle) |
| FR-AUTH-10 | — | FD §2, §10.3 | Supertest | TM pending |
| FR-AUTH-11 | 3 | FD §2 | Supertest, Playwright | TM pending (reset flow) |
| FR-AUTH-12 | — | FD §2 | Supertest | TM pending (session) |
| FR-AUTH-13 | — | FD §2 | Supertest (timing probe) | TM pending (enumeration) |
| FR-AUTH-14 | — | FD §9 | Supertest | TM pending (bot abuse) |
| FR-AUTH-15 | — | FD §10.3 | Supertest | TM pending (abuse) |
| FR-AUTH-16 | 6 | FD §7 (scopes) | Manual + code review | — |
| FR-AUTH-17 | — | FD §6 | Playwright | — |
| FR-AUTH-18 | 3 | F: Tracking users (merge) | Supertest, DB assertion | TM pending (merge edge cases) |
| FR-AUTH-19 | 3 | F: Tracking users (merge) | Supertest, DB assertion | TM pending |
| FR-AUTH-20 | — | FD §2 | Supertest | TM pending (CSRF) |

### 6.6 Consent, cookies & legal

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-CONSENT-01 | 6 | F: Tracking users (acknowledgement); L: Legal surface | Playwright | — |
| FR-CONSENT-02 | 6 | L: Legal surface | Automated header check | — |
| FR-CONSENT-03 | 6 | F: Ads | Supertest, DB assertion | — |
| FR-CONSENT-04 | 6 | FD §7 | Supertest, DB assertion | — |
| FR-CONSENT-05 | 6 | F: Licensing and openness; FD §3 | Supertest + legal review | — |
| FR-CONSENT-06 | 6 | Charter §4 item 6 | Playwright (cookie audit) | — |

### 6.7 Open-source banner

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-OSS-01 | 5 | F: Open-source banner | Playwright | — |
| FR-OSS-02 | 5 | F: Open-source banner | Playwright | — |

### 6.8 Settings

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-SET-01 | — | F: Settings page | Supertest | — |
| FR-SET-02 | 3 | F: Settings page | Supertest, Playwright | TM pending |
| FR-SET-03 | 6 | F: Settings page; L: Legal surface | Playwright | — |
| FR-SET-04 | 6 | F: Ads | Playwright, DB assertion | — |
| FR-SET-05 | 1 | F: Settings page | Playwright | — |
| FR-SET-06 | 3 | F: Settings page | Supertest, Playwright | TM pending (logout) |
| FR-SET-07 | 6 | FD §8 | Supertest, Playwright | TM pending (erasure) |
| FR-SET-08 | 6 | FD §8 | Supertest, DB assertion | TM pending (erasure completeness) |
| FR-SET-09 | 6 | FD §8 | Supertest | TM pending (restoration) |
| FR-SET-10 | — | — | Playwright | — |

### 6.9 Content & data seeding

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| FR-CONTENT-01 | 1, 5 | F: Licensing; L: Open-source files | Seed-script rerun + DB assertion | — |
| FR-CONTENT-02 | 1 | L: Iteration 2 | DB assertion | — |
| FR-CONTENT-03 | 1 | F: Word page (audio fallback) | DB + filesystem assertion | — |
| FR-CONTENT-04 | — | — (integrity) | Scheduled integrity job | — |
| FR-CONTENT-05 | 5 | F: Licensing | Playwright | — |
| FR-CONTENT-06 | 1 | F: Core concept | DB assertion | — |
| FR-CONTENT-07 | — | L: Iteration 1 | Runbook walkthrough | — |

### 6.10 Non-functional requirements

| ID | Charter SC | Handoff | Test vehicle | TM |
|----|-----------|---------|--------------|----|
| NFR-SEC-01 | 4 | Principles (security) | ASVS crosswalk | TM pending |
| NFR-SEC-02 | 4 | FD §2 | `testssl.sh` | TM pending |
| NFR-SEC-03 | 4 | FD §2 | Playwright + header test | TM pending |
| NFR-SEC-04 | 4 | Principles | Header test | TM pending |
| NFR-SEC-05 | 4 | Principles | Manual + HTML grep | TM pending |
| NFR-SEC-06 | 5 | Principles; D: dotenv | Secret scanner in CI | TM pending |
| NFR-SEC-07 | 4 | FD §2 | Lint rule, code review | TM pending |
| NFR-SEC-08 | 5 | D: CI | CI audit step | TM pending |
| NFR-SEC-09 | 4 | L: Hardening | ZAP scan | TM pending |
| NFR-SEC-10 | 4, 6 | Principles | Log-scraper test | TM pending |
| NFR-SEC-11 | — | FD §2 | Container topology check | TM pending |
| NFR-SEC-12 | 4 | FD §2 | Unit + code search | TM pending |
| NFR-PERF-01 | 4 | FD §4 | Lighthouse CI | — |
| NFR-PERF-02 | — | FD §4 | Lighthouse CI | — |
| NFR-PERF-03 | 4 | Charter §4 | Lighthouse CI | — |
| NFR-PERF-04 | — | — (operational) | k6 | — |
| NFR-PERF-05 | — | — (engineering) | Instrumented integration test | — |
| NFR-PERF-06 | 1 | FR-IPA-04 (reference) | see FR-IPA-04 | — |
| NFR-PERF-07 | 4 | FD §4 | size-limit in CI | — |
| NFR-PERF-08 | 4 | L: Hardening | k6 | — |
| NFR-A11Y-01 | 4 | L: Hardening | Playwright + axe-core + manual | — |
| NFR-A11Y-02 | 4 | Charter §4 | Lighthouse CI | — |
| NFR-A11Y-03 | 4 | — | Playwright (keyboard-only) | — |
| NFR-A11Y-04 | 4 | — | Playwright (focus tracer) | — |
| NFR-A11Y-05 | 4 | — | axe-core | — |
| NFR-A11Y-06 | 4 | — | Screen-reader snapshot test | — |
| NFR-A11Y-07 | 4 | — | Playwright (emulated preference) | — |
| NFR-A11Y-08 | 4 | — | Playwright (200 % font) | — |
| NFR-A11Y-09 | 4 | FD §3 | axe-core | — |
| NFR-A11Y-10 | 4 | — | axe-core + unit | — |
| NFR-A11Y-11 | 4 | WCAG 2.2 §2.5.8 | Playwright (visual measurement at 320 px) | — |
| NFR-A11Y-12 | 4 | WCAG 2.2 §2.4.11 | Playwright (focus + banner visibility) | — |
| NFR-A11Y-13 | 4 | WCAG 2.2 §3.3.7; FD §8 (deletion exception) | Playwright (multi-step flows) | — |
| NFR-A11Y-14 | 4 | WCAG 2.2 §3.3.8; FD §7 (Google OAuth path) | Playwright (paste + autocomplete) | — |
| NFR-PRIV-01 | 6 | Charter §4 item 6 | Code review gate | — |
| NFR-PRIV-02 | 6 | FD §6, §8 | Pruning-job dry run | — |
| NFR-PRIV-03 | 6 | FD §8 | Job-log review | — |
| NFR-PRIV-04 | — | GDPR | Runbook walkthrough | — |
| NFR-PRIV-05 | 6 | Charter §4 item 6 | Playwright network log | — |
| NFR-PRIV-06 | 6 | Principles | Threat Model DFD | TM pending |
| NFR-OPS-01 | 5 | L: Hardening | Scheduled backup observability | — |
| NFR-OPS-02 | — | — | Quarterly log file | — |
| NFR-OPS-03 | 5 | L: Hardening | Controlled-error test | — |
| NFR-OPS-04 | 6 | Principles | Rotation job observability | — |
| NFR-OPS-05 | — | — (operability) | Fresh-VPS rehearsal | — |
| NFR-OPS-06 | — | — | Policy doc review | — |
| NFR-OPS-07 | 5 | L: Hardening | Integration test | — |
| NFR-OPS-08 | 5 | D: CI | Branch-protection audit | — |
| NFR-COMPAT-01 | 4 | FD §5 | Playwright multi-browser | — |
| NFR-COMPAT-02 | — | FD §5 | Playwright at viewport extremes | — |
| NFR-COMPAT-03 | — | FD §5 | Playwright noScript | — |
| NFR-COMPAT-04 | 4 | FD §5 | Manual + Playwright | — |
| NFR-COMPAT-05 | — | FD §5 | Code review | — |
| NFR-I18N-01 | — | FD §3 | Manual | — |
| NFR-I18N-02 | — | — | DB + HTTP header test | — |
| NFR-I18N-03 | 1 | FR-IPA-09 (reference) | see FR-IPA-09 | — |
| NFR-I18N-04 | — | — | Unit + Playwright (simulated TZ) | — |
| NFR-I18N-05 | — | Post-v1.0 roadmap | Code review | — |
| NFR-LEGAL-01 | 6 | FD §3 | Threat Model crosswalk + legal review | — |
| NFR-LEGAL-02 | 6 | FD §3 | Legal review | — |
| NFR-LEGAL-03 | 5 | Charter §7 | CI licence-header lint | — |
| NFR-LEGAL-04 | 5 | Charter §7 | README review | — |
| NFR-LEGAL-05 | 5 | Charter §7; FR-CONTENT-05 | Playwright | — |
| NFR-LEGAL-06 | 5 | Charter §9 | File existence check in CI | — |
| NFR-LEGAL-07 | 5 | Charter §9 | File existence check in CI | — |
| NFR-LEGAL-08 | — | Charter §10 | PR-template review | — |

Charter Success Criteria recap for this matrix: (1) word-page reachability + rendering; (2) anonymous end-to-end flow; (3) registration + merge; (4) Lighthouse/WCAG/ZAP hardening; (5) public repo with full docs; (6) no non-essential cookies by default.

**Note on NFR-SEC-02:** its HSTS component ships as a four-phase, stability-milestone-tied ramp (see NFR-SEC-02); the single traceability entry above covers all four phases.

---

## 7. Appendices

### Appendix A — Reserved usernames

FR-AUTH-05 requires that reserved usernames be rejected at registration. The list below is the launch baseline; additions may be made by an internal-only config file committed to the repo. Matching is case-insensitive.

Administrative / role-like: `admin`, `administrator`, `root`, `superuser`, `sysadmin`, `sysop`, `staff`, `team`, `owner`, `maintainer`, `moderator`, `mod`, `support`, `help`, `billing`, `official`, `webmaster`, `postmaster`.

Technical / route-collision risks: `api`, `app`, `www`, `mail`, `email`, `ftp`, `ssh`, `static`, `assets`, `cdn`, `media`, `img`, `images`, `audio`, `video`, `files`, `download`, `upload`.

PronounceAll-specific routes or concepts: `settings`, `account`, `profile`, `login`, `logout`, `register`, `signup`, `signin`, `reset-password`, `verify-email`, `privacy`, `kvkk`, `about`, `contact`, `terms`, `legal`, `cookies`, `learnipa`, `practice`, `search`, `word`, `words`, `phoneme`, `phonemes`, `ipa`, `en-us`, `en-gb`, `fr-fr` (and any future variant code).

Abuse / impersonation deterrents: `pronounceall`, `anthropic`, `claude`, `google`, `cloudflare`, `system`, `null`, `undefined`, `anonymous`, `deleted`, `user`.

Profanity: sexual, hateful, and slur-type handles are additionally rejected via an externally maintained blocklist (for example the LDNOOBW list, or an equivalent npm package such as `fka/cuss`) loaded from a config file at startup. The blocklist is deliberately not enumerated in this repository; the specific package is selected in the SDD.

The list is maintained in a single source-controlled file. Adding a new route to the application triggers an implied addition to this list; the Runbook documents the procedure.

### Appendix B — Phoneme example-word list

Deferred to the SDD, per Handoff Open Questions. The list is drafted in the SDD using Cambridge and Wiktionary references and ideally reviewed by a phonetician before launch. The seed script (FR-CONTENT-02) populates `phonemes` and `phoneme_example_words` from this list.

Count: 41 phonemes for `en-us` (FR-IPA-01), per the canonical inventory and transcription convention documented in the SDD's standalone phoneme artifact.

### Appendix C — Rate-limit quick reference

Normative source: Foundational Decisions §10.3, enforced by FR-AUTH-15 (authentication endpoints), FR-WORD-05 (word-request), FR-SAVE-08 (idempotency bucket infrastructure), and NFR-SEC-11 (Redis-backed store). Reproduced here for ease of audit.

| Endpoint | Limit | Identity key | Primary FR/NFR |
|----------|-------|--------------|----------------|
| `POST /login` | 5 / 15 min | UUID + IP | FR-AUTH-15 |
| `POST /register` | 3 / 1 h | IP | FR-AUTH-15 |
| `POST /reset-password` | 3 / 1 h | email address | FR-AUTH-15 |
| `POST /verify-email/resend` | 3 / 1 h | account ID | FR-AUTH-10 / FR-AUTH-15 |
| `POST /request-word` | 10 / 1 h | UUID | FR-WORD-05 |
| Save/tag POSTs | 60 / 1 min | UUID | FR-SAVE-09 (audio-listen events share this bucket) |
| `GET /:variant/:word` | 120 / 1 min | UUID | — (scraping defence) |
| All endpoints (edge) | 1000 / 1 min | IP | NFR-SEC-02 (edge WAF) |

On breach: HTTP 429 + `Retry-After`. Counter store: Redis in staging/production (NFR-SEC-11).

### Appendix D — Cookie inventory (launch baseline)

Normative source: FR-CONSENT-02. The Privacy Policy and Cookie Table shall reflect this inventory and shall be kept synchronised by the automated check in FR-CONSENT-02's acceptance criteria.

| Name | Category | Purpose | Duration | Scope | HttpOnly | Secure | SameSite |
|------|----------|---------|----------|-------|----------|--------|----------|
| `pa_uid` | Strictly necessary | Anonymous profile identifier (FR-AUTH-01) | 2-year sliding | Origin | **No** (JS access required for localStorage mirror per FR-AUTH-02) | Yes | Lax |
| `pa_sid` | Strictly necessary (authenticated users only) | Session token (FR-AUTH-12) | 12 h absolute / 30 min idle | Origin | Yes | Yes | Lax |
| `pa_csrf` or `XSRF-TOKEN` | Strictly necessary | CSRF token (FR-AUTH-20) | Session-scoped | Origin | Configurable per CSRF scheme — documented in SDD | Yes | Lax |
| Cloudflare `cf_*` cookies (edge) | Strictly necessary | WAF / bot management at the edge | Per Cloudflare policy | Origin | Yes | Yes | Lax or None per Cloudflare |
| `pa_ads_*` (if ever enabled) | Non-essential, opt-in only | Ad personalisation | Per ad network, TBD | Origin | Per ad network | Yes | Lax |

No other cookies are permitted. Any new cookie requires an update to this table, to the Privacy Policy, and to FR-CONSENT-02's automated check in the same PR.

### Appendix E — PII field inventory

Normative source: NFR-PRIV-01. Each field has a justifying FR and a retention rule (NFR-PRIV-02).

| Field | Table | Category | Justifying FR | Retention |
|-------|-------|----------|----------------|-----------|
| `user_id` | `users` | Pseudonymous identifier | FR-AUTH-04 | Until hard-delete |
| `username` | `users` | Chosen handle (public) | FR-AUTH-04, FR-AUTH-05 | Until hard-delete |
| `email` | `user_accounts` | Contact / auth recovery | FR-AUTH-04, FR-AUTH-06, FR-AUTH-09 | Until hard-delete |
| `email_verified_at` | `user_accounts` | Verification state | FR-AUTH-09 | Until hard-delete |
| `password_hash` | `user_accounts` | Authenticator | FR-AUTH-08 | Until hard-delete |
| `google_sub` | `user_accounts` | Google OAuth subject | FR-AUTH-04, FR-AUTH-16 | Until hard-delete |
| `profile_picture_url` (cached or direct from Google) | `user_accounts` | Display | FR-AUTH-16 | Until hard-delete |
| `anonymous_id` | `anonymous_profiles` | Pseudonymous identifier | FR-AUTH-01, FR-AUTH-03 | 2-year dormancy |
| Event log rows | `user_activity_events` | Progress data | FR-SAVE-03 | Until hard-delete or dormancy prune |
| Anonymous-to-account bindings | `identity_bindings` | Pseudonymous linkage (anonymous identity to account) | FR-AUTH-18 | Until account hard-delete; follows the account lifecycle, not dormancy-pruned |
| Consent records | `consent_records` | Legal demonstrability | FR-CONSENT-03, FR-CONSENT-04 | Until hard-delete |
| Session rows | `sessions` (or Redis) | Authenticator | FR-AUTH-12 | Idle/absolute timeouts |
| Verification / reset tokens (hashed) | `auth_tokens` | Auth workflow | FR-AUTH-09, FR-AUTH-11 | Token-specific (24 h / 1 h) |
| IP in access logs | log files | Operational | NFR-SEC-10 | 30 days |
| Word-request submitter reference | `word_requests` | Deduplication (up-vote counter) | FR-WORD-05 | Nulled on account hard-delete |
| Deletion tombstone | `deletion_audit` | Audit (no PII) | FR-SET-08 | Indefinite |

No IP address is stored in any application table. No real name, date of birth, phone number, postal address, or payment information is collected by v1.0. Any addition requires the change-control action in NFR-LEGAL-08.

### Appendix F — Endpoint catalogue quick reference

The canonical source of endpoints is the API Specification (OpenAPI 3.1 YAML). This appendix is a flat reference for traceability convenience and may lag; the OpenAPI document is authoritative.

**Public GET:**
- `GET /` — home.
- `GET /:variant/:word` — word page (FR-WORD-01, FR-WORD-03, FR-WORD-04 for 404).
- `GET /:variant/learnIPA` — per-language phoneme index (FR-IPA-07).
- `GET /learnIPA` — global phoneme index across all variants (FR-IPA-10).
- `GET /practice` — practice session (FR-PRACTICE-01).
- `GET /settings` — settings (FR-SET-01).
- `GET /privacy`, `GET /kvkk` — legal (FR-CONSENT-05).
- `GET /register`, `GET /login`, `GET /reset-password` — auth forms (FR-AUTH-04, FR-AUTH-11).
- `GET /healthz` — health (NFR-OPS-07).
- `GET /sitemap.xml`, `GET /robots.txt` — SEO (FR-WORD-09 implied).

**State-changing POST (all require CSRF per FR-AUTH-20):**
- `POST /save` — save/tag (FR-SAVE-02, FR-SAVE-07, FR-SAVE-08).
- `POST /request-word` — word request (FR-WORD-05).
- `POST /register`, `POST /login`, `POST /logout` — auth (FR-AUTH-04, FR-AUTH-12, FR-SET-06). Turnstile required on register/login (FR-AUTH-14).
- `POST /reset-password`, `POST /verify-email/*` — auth workflows (FR-AUTH-09, FR-AUTH-10, FR-AUTH-11).
- `POST /settings/*` — account mgmt, cookie prefs, ad toggle, language (FR-SET-02, FR-SET-03, FR-SET-04, FR-SET-05).
- `POST /settings/delete` (two-step) — account deletion (FR-SET-07).
- `POST /practice/attempt` — self-assessment (FR-PRACTICE-03).

**External callbacks:**
- `GET /auth/google/callback` — OAuth callback (FR-AUTH-04, FR-AUTH-16).

---

*End of PronounceAll SRS v1.0. This document merges SRS Rounds 2 and 3 and applies the sixteen Round 4 maintainer decisions. The earlier tension between FR-SAVE-03 (append-only event log at the database-privilege level) and FR-AUTH-18 (merge-on-login) over whether the merge performs an UPDATE has been resolved by SDD Round 1 decision B1: merge-on-login appends a `LINK` to the append-only `identity_bindings` table rather than updating event rows, so both requirements hold without conflict. Downstream: SDD, ERD, API Specification, Threat Model.*
