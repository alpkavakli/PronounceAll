# PronounceAll — Software Requirements Specification

**Version:** 0.2 (Round 2 draft: §1–3 + all Functional Requirements)
**Status:** Draft — pending Round 3 (NFRs + traceability matrix) and Round 4 (polish)
**Owner:** Alp K. (solo developer)
**Domain:** pronounceall.com
**Scope of this document:** v1.0 release (American English only)
**Derived from:** Project Charter v1.0, Project Handoff Document v1.0 (Feature Brief v0.1 Locked), SRS Foundational Decisions (Round 1)

---

## Table of contents

1. Introduction
2. Overall description
3. Requirements conventions
4. Functional requirements
   - 4.1 Word pages — `FR-WORD-*`
   - 4.2 IPA system — `FR-IPA-*`
   - 4.3 Save & tag system — `FR-SAVE-*`
   - 4.4 Practice sessions — `FR-PRACTICE-*`
   - 4.5 Authentication & account lifecycle — `FR-AUTH-*`
   - 4.6 Consent, cookies & legal — `FR-CONSENT-*`
   - 4.7 Open-source banner — `FR-OSS-*`
   - 4.8 Settings — `FR-SET-*`
   - 4.9 Content & data seeding — `FR-CONTENT-*`

(Non-functional requirements, traceability matrix, appendices, and glossary are deferred to Round 3.)

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

The system shall render, for every word present in the dictionary for the requested variant, a page containing at minimum: the word itself as the page heading; its meaning(s) sourced from the dictionary; its IPA transcription with each phoneme rendered as a clickable element (see §4.2); a whole-word audio control; and a written syllable/stress breakdown.

**Acceptance criteria:**
- Every field listed above is present in the rendered HTML for `GET /en-us/cupcake` and any other seeded word.
- The IPA transcription's phoneme elements each expose a stable data attribute (`data-phoneme-id`) keyed to a row in `phonemes`.
- The syllable/stress breakdown identifies primary stress and, where applicable, secondary stress using the standard IPA markers `ˈ` and `ˌ`.
- Meaning(s) are attributed to the upstream dictionary source in a visible footer on the word page.

#### FR-WORD-04 — Unknown-word page with fuzzy suggestions. *Priority: Must.*

When a request is made to `/:variant/:word` and `:word` does not exist in the dictionary for that variant, the system shall return HTTP 404 with a dedicated page that: (a) states the word is not yet in the dictionary; (b) shows up to five fuzzy-match suggestions computed via Levenshtein distance ≤ 2 against the dictionary, ranked by distance then by frequency; (c) offers a word-request control (see FR-WORD-05).

**Rationale:** Making 404s helpful converts typos into successful lookups and channels genuine gaps into the word-request backlog.

**Acceptance criteria:**
- `GET /en-us/cuppcake` returns HTTP 404 and displays `cupcake` among its suggestions.
- `GET /en-us/xqzzy` returns HTTP 404, shows no suggestions (none within distance 2), and still offers the word-request control.
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

**Rationale:** A tiny dictionary defeats the Charter's vision. 5 000 headwords is enough for demonstrable utility while remaining within TTS free-tier and QA budgets.

**Acceptance criteria:**
- `SELECT COUNT(*) FROM words WHERE variant = 'en-us'` ≥ 5 000 on the launch database.
- For every seeded word, `word_pronunciations` has at least one IPA entry and `audio_assets` has at least one playable asset or a confirmed Web-Speech-API fallback configuration.

### 4.2 IPA system — `FR-IPA-*`

#### FR-IPA-01 — Phoneme table coverage. *Priority: Must.*

The `phonemes` table shall contain one row for each distinct phoneme of American English (approximately 44 symbols, including diphthongs and stressed/unstressed distinctions where phonemically relevant). Each row shall include: the IPA symbol (NFC-normalised), a stable internal ID, a frequency rank, at least one example word, and a reference to an audio asset.

**Acceptance criteria:**
- `SELECT COUNT(*) FROM phonemes WHERE variant = 'en-us'` returns the locked count (documented in the SDD) — in the range 43–45.
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

The popover opened by a phoneme click shall contain: the IPA symbol, a replay button for the phoneme audio, one popular example word that starts with that sound (matched by sound, not by spelling), and a control to save/tag the phoneme.

**Rationale:** Teaches by example, avoids the spelling-vs-sound trap (e.g. for `/k/` the example should be `cat`, not a K-initial word like `knife`).

**Acceptance criteria:**
- For `/k/`, the example word is matched by `phoneme_example_words.match_mode = 'sound'` and the displayed word begins phonetically with `/k/`.
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
- A linter or seed-validation test rejects phoneme rows where the displayed example's first phoneme differs from the target phoneme.

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

Every state-changing action on a save target and every audio-listen and practice-attempt shall write a row to `user_activity_events` containing, at minimum: event ID (UUID), actor reference (exactly one of `anonymous_id` or `user_id` populated), target kind (`word` or `phoneme`), target ID, event type (`save`, `unsave`, `tag_change`, `audio_listen_word`, `audio_listen_phoneme`, `practice_attempt`), event value (nullable — the tag for `tag_change`, null for an untagged reset, the SM-2 rating for `practice_attempt`), and timestamp in UTC. Rows shall never be updated or deleted by application code except during account hard-deletion (see FR-SET-08).

**Rationale:** Append-only is the foundation of the merge-on-login rule and of the deterministic derivation of `user_word_states`, `user_phoneme_states`, and `sm2_states`.

**Acceptance criteria:**
- Tagging a saved word `learned` produces exactly one new row; no existing rows are modified.
- Application code has no code path that performs `UPDATE` or `DELETE` against `user_activity_events` outside the hard-deletion flow.
- The database user owned by the application has `INSERT` and `SELECT` privileges on the table; `UPDATE` and `DELETE` privileges are granted only to the deletion worker.

#### FR-SAVE-04 — Derived state consistency. *Priority: Must.*

`user_word_states` and `user_phoneme_states` shall reflect, for each (actor, target) pair, the most recent non-`audio_listen`, non-`practice_attempt` event. The derivation rule is deterministic: the latest qualifying event's type/value dictates the state; earlier events are superseded but preserved in the log.

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

#### FR-SAVE-09 — `audio_listen` events. *Priority: Must.*

Playing phoneme audio or whole-word audio shall write an `audio_listen` event to the event log, tagged with the target kind and target ID. These events do not affect derived save state.

**Rationale:** Audio listens inform the future "your weakest phonemes are…" analytics that are out of scope for v1.0 but whose data should be captured now to avoid a rewrite later.

**Acceptance criteria:**
- Clicking a phoneme on `/en-us/cupcake` produces one `audio_listen` event per click, rate-limited under §10.3 (save/tag bucket).
- Derived save state does not change as a consequence of an `audio_listen` event.

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

The system shall implement the SM-2 algorithm for each (actor, word) pair, maintaining state in `sm2_states`: repetition count, ease factor (initialised to 2.5, floor 1.3), interval in days, next-due timestamp. Self-assessment "right" shall be interpreted as SM-2 quality 4; "wrong" as quality 2. Ease factors and intervals update per the standard SM-2 formulas.

**Rationale:** Handoff fixes SM-2 as the algorithm. Mapping self-assessment "right/wrong" to quality ratings 4/2 avoids the complication of a five-button grading UI while preserving SM-2's behaviour — quality 2 triggers a reset, quality 4 advances.

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

A practice session shall end when: the viewer has answered every due word at least once and no reinsertions remain queued; or the viewer leaves the practice page; or the session's absolute idle timeout (30 minutes) elapses. On termination the `practice_sessions` row is finalised (end timestamp, total attempts, correct count).

**Acceptance criteria:**
- Completing a short session (3 due words, no wrong answers) finalises the row with `end_ts`, `total_attempts = 3`, `correct_count = 3`.
- Closing the tab mid-session causes the row to be finalised on the next scheduled sweep (operationally covered in the Runbook) or on the user's next visit, whichever is first.
- A 30-minute idle timer fires a finalisation event when no interaction occurs.

#### FR-PRACTICE-07 — Practice of phonemes. *Priority: Won't (this release).*

`[OUT-OF-SCOPE for v1.0]` IPA-subset practice (asking the user to pronounce a word composed of specific phonemes) is deferred past v1.0. Requires a word-search algorithm over phoneme subsets and is explicitly listed in Charter §6 and Handoff's post-v1.0 section.

### 4.5 Authentication & account lifecycle — `FR-AUTH-*`

#### FR-AUTH-01 — Anonymous UUID cookie issuance. *Priority: Must.*

On any request that does not already carry a valid UUID cookie, the system shall issue a new v4 UUID and set it as a cookie named `pa_uid` with attributes: `HttpOnly=false` (required for the `localStorage` mirror in Foundational Decisions §6), `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=63072000` (2 years). The `Max-Age` shall be refreshed on every subsequent request so the cookie's lifetime slides.

**Rationale:** Foundational Decisions §6 locks sliding 2-year expiry and mirrors the UUID into `localStorage` as an explicit tradeoff; the mirror needs JS access, hence no `HttpOnly`. This is an accepted tradeoff — any XSS that could read `localStorage` could also read this cookie; see Threat Model.

**Acceptance criteria:**
- The first response to a fresh client includes `Set-Cookie: pa_uid=…; Max-Age=63072000; Path=/; Secure; SameSite=Lax`.
- Every subsequent request that carries the cookie yields a response that refreshes `Max-Age`.
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

Usernames shall: be unique across all accounts under case-insensitive comparison; consist of 3–20 characters from `[a-zA-Z0-9_-]`; begin with a letter (`[a-zA-Z]`); be stored in the form the user typed but compared case-insensitively. No discriminator (`#1234`) is appended. Reserved usernames (e.g. `admin`, `root`, `api`, `settings`) are rejected; the reserved list is maintained in source.

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

When a user successfully authenticates and the browser carries a non-empty anonymous UUID whose `anonymous_profiles` row is not already linked to an account, the system shall merge the anonymous events into the registered account by re-pointing `user_activity_events.anonymous_id` to `user_activity_events.user_id = <that account>`. Derived-state tables are recomputed post-merge. The merge rule is: for each (target kind, target ID), the most recent event (by timestamp) wins.

**Rationale:** Handoff. Latest-event-wins produces a deterministic merge that handles cross-device use without ambiguous reconciliation prompts.

**Acceptance criteria:**
- An anonymous user who tagged `cupcake` as `learning` at T1, then logs into an account where `cupcake` was tagged `learned` at T0 (earlier), has `cupcake` end up as `learning` in the merged account.
- If timestamps are identical to the second (extremely rare), the registered-user event wins (documented in the Threat Model).
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

The hard-delete job shall permanently remove or irreversibly anonymise: the `users` row, all `user_accounts` rows for that user, all `user_word_states` and `user_phoneme_states` rows, all `sm2_states` rows, all `practice_sessions` and `practice_attempts` rows, the user-owned subset of `user_activity_events`, all `consent_records` rows, all session rows. Word requests previously submitted by the user are retained with the `submitted_by_user_id` nulled (they become ownerless). A tombstone row referencing a deletion ID (no PII) is retained for audit.

**Rationale:** Foundational Decisions §8.

**Acceptance criteria:**
- After a hard-delete the email and username are available for reuse by a future registration.
- No PII remains in the named tables for the deleted user.
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

Every audio asset referenced by `audio_assets` shall have: a file present on disk at the expected path, a recorded SHA-256 digest, a recorded MIME type, and a non-zero byte length. A startup or nightly integrity check verifies each referenced asset.

**Acceptance criteria:**
- The integrity check running against the launch dataset reports zero missing, zero digest mismatches, zero zero-byte files.

#### FR-CONTENT-05 — Upstream attribution on word pages. *Priority: Must.*

Every word page shall display, in a visible footer or near the meaning, the upstream source attribution and licence (e.g. "Meaning from Wiktionary · CC BY-SA 4.0") with a link to the source entry.

**Rationale:** CC BY-SA 4.0 requires attribution; the Charter §7 pledges to preserve upstream licensing terms.

#### FR-CONTENT-06 — Language-variant table. *Priority: Must.*

The `language_variants` table shall contain exactly one row for v1.0: `en-us` with a human-readable name ("American English") and an `is_active = true` flag. Routes to inactive variants return HTTP 404.

#### FR-CONTENT-07 — Word-request processing workflow. *Priority: Should.*

The maintainer shall have a documented operational workflow (in the Runbook) for reviewing, accepting, and rejecting rows in `word_requests`. v1.0 does not ship an in-app admin UI; the workflow operates via database queries and re-runs of the seed pipeline. Acceptance creates `words` and `word_pronunciations` rows; rejection flags the request row.

**Rationale:** Handoff defers admin UI past v1.0; the operational procedure still needs to exist.

---

*End of Round 2 draft. Non-functional requirements, the traceability matrix, the use-case cross-reference, and appendices (including the exact phoneme list, the reserved-username list, and the requirement-to-test mapping) are produced in Round 3.*
