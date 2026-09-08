## **PronounceAll — Project Handoff Document v1.0**

**I used this for project charter creation with claude.**

*This document is the single source of truth passed into each subsequent chat. When starting a new document (Charter, SRS, SDD, etc.), paste this file as the first message along with the instruction for the next artifact. Once a document is completed, append it to this handoff file and carry the updated version forward.*

### **How to use this document**

**Starting a new chat with Claude for document generation:**

1. Paste this entire handoff document as your first message.
2. Add one line at the end stating which document to produce next (e.g., "Now generate the Project Charter based on this.").
3. Once Claude produces the document, append it to this file under the "Completed Documents" section before starting the next chat.

**Why:** Claude has no memory between chats. Each new chat starts empty. This file gives every new Claude instance the full project context without requiring me to re-explain.

### **Project Summary**

**Name:** PronounceAll **Domain:** pronounceall.com **Type:** Open-source web application for learning English pronunciation through IPA (International Phonetic Alphabet) **License:** AGPL-3.0 for code, CC BY-SA 4.0 for content **Stack:** Node.js + Express + EJS + raw CSS + MySQL, deployed via Docker on Hetzner VPS behind Cloudflare with Nginx reverse proxy **Developer:** Solo developer (Alp K.), building as an open-source contribution

**Core philosophy:** Free forever, minimum personal data collection, auditable open code, covers only operational costs (no profit motive). Ads are opt-in only. Dictionary data sourced from open dictionaries (Wiktionary primarily).

### **Feature Brief v0.1 (Locked)**

#### **Core concept and URL structure**

Every word has its own page. The URL pattern is pronounceall.com/:variant/:word where variant is a language variant code like en-us, en-gb, fr-fr. Example: pronounceall.com/en-us/cupcake. Each variant is treated as its own language even if two variants share an alphabet — American English and British English have different IPA transcriptions for the same word, so they get different pages.

v1.0 ships with American English (en-us) only. British English joins later, in the same release where other languages like French are added.

When a user visits a word not in the dictionary, a friendly "we don't know this word yet" page appears. It suggests similar known words via fuzzy matching (Levenshtein distance) and lets the user request the word so it can be added later.

#### **The word page**

Each word page shows three things: the word itself, its meaning, and its pronunciation.

Pronunciation is taught in three ways. The main way is the IPA transcription — each IPA symbol of the word is a clickable element. When a symbol is clicked, that single phoneme's audio plays and a small "learn to pronounce" popover appears containing: the symbol, a button to replay the phoneme, and a popular example word that everyone knows how to pronounce which starts with that sound (matched by sound, not by English letter — so for /k/ the example might be "cat", not a word starting with the letter K). The second way is whole-word audio — one button plays the entire word. The third way is a written explanation below, showing how the word breaks into syllables and where the stress is.

Audio sourcing has a fallback chain. Wiktionary human recordings are tried first. If unavailable, AI-generated TTS is used (pre-batched on the server, one-time generation from a provider like Google Cloud TTS or Azure — both have free tiers large enough to cover a full English dictionary). If both fail, the browser's Web Speech API synthesizes at runtime. For individual IPA phonemes, a one-time set of audio files is outsourced initially, and Alp K. re-records them in his own voice later when he has time.

#### **Saving words**

Every word page has a single save button, working like Instagram post saving. Tap once to save the word. Once saved, an optional popover lets the user tag it as "learning it" or "learned" — but tagging is not required. Untagged saved words live in their own implicit "just saved" folder.

The tag affects how the word appears in practice sessions. Untagged and "learning" words are asked at full frequency. "Learned" words are asked at half frequency. This same save/tag mechanism also applies to individual IPA phonemes on both the /learnIPA page (global, all variants) and the /:variant/learnIPA page (per-language).

#### **Tracking users (two modes)**

The first mode is anonymous tracking via a long-lived cookie. When a visitor enters the site for the first time, a small informational notice appears explaining that PronounceAll uses a strictly necessary cookie to save their word-learning progress, with a link to the privacy policy. The user clicks "OK, got it" to dismiss the notice; this is acknowledgment, not consent, because under GDPR and KVKK strictly necessary cookies do not require consent. The cookie contains a UUID, and the backend creates an anonymous\_profile row keyed to that UUID. Every word they visit, every audio they listen to, every save action is recorded against their UUID.

This cookie is strictly necessary and cannot be disabled through the site, because the entire purpose of the app — saving words and tracking progress — literally cannot work without it. The legal basis is the same as a shopping-cart cookie on an e-commerce site: required to deliver the service the user is using. The only users who remain untracked are those who disable cookies at the browser level entirely; in that case the site gracefully degrades to a read-only word-browsing mode where save buttons show an "enable cookies to save progress" message.

If ads are enabled later, the ad-personalization cookie will be a separate, non-essential, opt-in-only cookie that users can disable at any time. That is the only cookie users can toggle.

The second mode is registered accounts. Users can sign up via email-and-password or Google OAuth, at pronounceall.com/register and pronounceall.com/login. Either way, during their first registration step they choose a username. Usernames are unique, so no discriminator system is needed. The bare minimum of personal data is collected — for Google login, only email and profile picture; for email registration, only email and a hashed password.

Registration is optional. If a user never signs up, their anonymous cookie profile keeps their data just as well. Registration exists so users don't lose their progress if they clear cookies or switch devices.

When a user logs in, their current anonymous profile is merged into their account. The merge rule: every event is kept with its timestamp, and for each target (word or phoneme), the latest event wins. If they later log in from a different device that has its own anonymous profile, that profile is merged into the same account. If they sign into a different account on a different device, those anonymous events go to that other account — nothing can be done. The event model is append-only: every save, tag change, audio-listen, practice answer is logged with a timestamp; derived state tables (saved words list, tags, SM-2 state) are computed from those events, so merging is straightforward.

#### **The IPA learning flow**

Every word page has a prominent link or banner that says something like: "Learn every sound in English! Just learn these **N** IPA symbols to pronounce every word," where N is read from the phoneme table. The number is pulled from the phoneme table, not hardcoded.

Once a user has started learning IPA, this banner becomes progress-aware: "**12/N** — doing great! N−12 to go." The numbers come from their user\_phoneme\_states — how many phonemes they've tagged as "learned"; "learning" does not advance the count..

The banner links to pronounceall.com/en-us/learnIPA (the per-language page for the user's active variant). This page teaches each IPA symbol with its sound and an example word. Symbols are ordered by frequency in English, from most common to least. Each row on this page has the symbol, a play button, the example word, and the same save/tag system (save / learning / learned) that word pages have.

#### **Practice sessions**

Two separate practice flows.

**Saved-words practice.** The user visits a "practice my saved words" page. One saved word is served at a time. If the word is untagged or tagged "learning", it's asked at full frequency. If tagged "learned", it's asked at half frequency. For each word, the user sees the word (and hears it if they want), then self-assesses: did I pronounce it right, yes or no? This answer feeds the **SM-2 spaced repetition algorithm** (the well-studied algorithm used by Anki), which calculates when to ask the word next. Hard words come back sooner, easy words drift to longer intervals. Wrong answers reset the word's interval and the word reappears within the next 3-7 rounds of the current session. Microphone-based speech recognition is not used; v1.0 is pure self-assessment.

**IPA practice (post-v1.0).** When a user is learning specific IPA letters, the app asks them to pronounce words composed only of those letters. This needs a search algorithm to find suitable words for any arbitrary subset of phonemes (non-trivial), so it is deferred until after v1.0.

#### **Open-source banner**

Every page shows a small, non-intrusive banner (at the bottom or in a corner) saying something like "PronounceAll is open-source and free. We don't want your data, we want to share knowledge." It can be closed with an X. When closed, it stays hidden for 30 minutes, then reappears. The 30-minute state is kept in localStorage (not a cookie, to keep the KVKK cookie list minimal). The banner is not about getting users to enable ads — it's about sharing the open-source and free-software culture.

#### **Ads (not default, must opt-in)**

Default: no ads, for everyone. In settings, users can opt in to ads. Only users who have opted in see ads; only their browsing feeds the ad network. This is equivalent to giving everyone a free premium account.

If mainstream ad networks won't accept this model (because they require ads-always-on), they are skipped. Alternatives: run own banner ads, use a privacy-respecting network (EthicalAds, CodeFund), or switch to a donation model (Ko-fi, GitHub Sponsors, Liberapay). Revenue goal is only to cover server, domain, database, and related operational costs. No profit motive.

#### **Settings page**

Account management (change email, change password, delete account — full Right to Erasure for KVKK/GDPR compliance). Cookie preferences (with the essential cookies grayed out as non-negotiable, with an explanation why). Ad opt-in toggle. Language variant selector (locked to en-us for v1.0, but the dropdown UI is in place). Logout.

#### **Licensing and openness**

**Code: AGPL-3.0.** Anyone can read, modify, and reuse the code, but if they run a modified version as a network service (like a copy of PronounceAll at another domain) they must publish their modifications. This prevents someone from taking the work, monetizing it, and never giving back. They can either keep their modifications strictly private (never serve them to anyone) or they must share them openly — no middle ground.

**Content (IPA example-word lists, documentation, own recordings if made): CC BY-SA 4.0.** Same philosophy applied to non-code assets.

**Dictionary data:** sourced from open dictionaries, Wiktionary primarily. Attribution requirements respected.

#### **Post-v1.0 (later)**

Expansion to French, Turkish, Spanish, British English, etc. Native mobile apps (iOS and Android) — approach to be researched later. Speech-recognition-based IPA practice (maybe, if the project gains traction). Community-contributed audio (Wiktionary-style voluntary submissions). Dark mode. User-facing analytics ("your weakest phonemes are /θ/ and /ð/").

#### **Technical stack**

* **Backend:** Node.js + Express + EJS (server-rendered HTML)
* **Frontend:** Raw CSS for styling, progressive enhancement via vanilla JS for client-side interactions (save popover, IPA click-to-play, practice session)
* **Database:** MySQL
* **Infrastructure:** Docker + docker-compose for local dev and production parity
* **Hosting:** Hetzner VPS behind Cloudflare, Nginx as reverse proxy and static file server, Certbot for HTTPS
* **Secrets:** dotenv
* **Version control:** GitHub, public repo from day one
* **CI/CD:** GitHub Actions on every push — lint (ESLint), test (Jest + Supertest + Playwright), security audit (npm audit --audit-level=high). Free for public repos.

#### **Security and privacy principles**

Minimum data collection. For Google OAuth, only email and profile picture. For email signup, email and hashed password. No phone numbers, no real names, no location, no analytics beyond anonymous aggregate usage (if any).

Every cookie is documented in a cookie table and justified. Essential cookies are the only ones set by default; anything non-essential requires explicit opt-in.

The app is designed to be auditable because it's open-source. Security comes from correct design and code review, not obscurity. All controls are documented in the Security Controls document. Standard hardening: Helmet middleware, CSP headers, rate limiting, parameterized queries, bcrypt for passwords, HttpOnly + Secure + SameSite cookies, CSRF tokens on state-changing POSTs, dependency scanning in CI.

### **v1.0 Launch Scope (Locked, Ordered)**

The v1.0 release is built feature-by-feature in the following order. **Each feature must be complete and deployed to staging before the next one starts.** The design phase must account for dependencies between features — downstream features will need hooks in the data model and architecture established by earlier features.

1. **Iteration 0 — Foundation.** Repo initialization with AGPL-3.0, open-source files, Express + EJS skeleton, MySQL with bare minimum schema, cookie-issuing middleware, Docker setup, CI pipeline, staging deploy. No user-facing features yet.
2. **Iteration 1 — Word pages.** GET /:variant/:word rendering word, meaning, and static IPA transcription. URL normalization. 404 with fuzzy-match suggestions and word-request capture. Responsive mobile layout. Seed dataset of ~100 common American English words.
3. **Iteration 2 — IPA system.** Clickable IPA symbols with phoneme popover (symbol + replay + example word). phonemes table seeded with the full canonical en-us pedagogical inventory + audio. /:variant/learnIPA (per-language) and /learnIPA (global) pages, both with frequency-ordered phoneme lists; in v1.0 they render identical content because en-us is the only seeded variant. Whole-word audio button with Wiktionary → AI TTS → Web Speech API fallback chain.
4. **Iteration 3 — Save/tag system.** Three-state save for words (saved / learning / learned) and the identical system for phonemes on both /:variant/learnIPA and /learnIPA. Works for anonymous users immediately via UUID cookie. Append-only event log + derived state tables in place.
5. **Iteration 4 — Authentication (both modes).** Email + password with bcrypt, Google OAuth, unique username collection, email verification, password reset, session management. Anonymous-to-registered merge logic on login.
6. **Iteration 5 — Practice sessions.** Saved-words practice page with SM-2 algorithm. Self-assessment UI. Frequency weighting by tag (full / half). Wrong-answer reinsertion at random 3-7 rounds.
7. **Iteration 6 — Settings page.** Account management (change email/password, delete account with full data erasure). Cookie preferences (essential grayed out). Ad opt-in toggle (UI only for v1.0 if ads aren't integrated yet). Language variant selector (en-us only). Logout. Open-source banner on every page with 30-minute localStorage dismissal.
8. **Iteration 7 — Hardening.** No new features. OWASP ZAP scan. Lighthouse audit ≥ 90. Accessibility audit (axe-core, WCAG 2.2 AA). Load test (k6). Sitemap + SEO meta tags. Error tracking (Sentry free tier). Logging review. Backup automation. Threat Model verification — every identified threat has a working control.

**Post-v1.0 features** (not part of v1.0 scope): IPA exams, multi-language expansion, British English, native mobile apps, community-contributed audio, dark mode, user-facing analytics, advertisements integration if opt-in model is accepted by a network.

**Dependency note:** Features depend on each other and cannot be built in isolation. For example, the save system (Iteration 3) requires the anonymous-profile infrastructure from Iteration 0 and the word pages from Iteration 1; the authentication system (Iteration 4) must cleanly merge the already-existing anonymous data from Iteration 3; the practice sessions (Iteration 5) consume the event log established in Iteration 3. The design phase (SDD + ERD + API Spec) must anticipate all seven iterations so later features can plug into the earlier architecture without rewrites.

### **Documents to Produce (In Order)**

Each document is produced in a dedicated chat. After each document is completed, it must be appended to this handoff file under "Completed Documents" before the next chat begins.

#### **Phase 0 — Requirements (before any code)**

1. **Project Charter** — 1 page. Vision, target users, problem statement, success criteria, in-scope, out-of-scope, licensing statement.
2. **Software Requirements Specification (SRS)** — 20–30 pages. Numbered, testable functional and non-functional requirements grouped by area (WORD, IPA, SAVE, PRACTICE, AUTH, CONSENT, OPEN-SOURCE, SETTINGS, CONTENT) with stable IDs like FR-WORD-01, NFR-SEC-03.
3. **Use Case Diagram + Descriptions** — 5 pages. Actors: Anonymous Visitor, Registered User, Administrator, Google OAuth Provider, Wiktionary API, TTS Provider. Mermaid diagram + description table per use case.

#### **Phase 1 — Design (design before code)**

1. **Software Design Document (SDD)** — 30–40 pages. Architectural overview, component-by-component design, design decisions with rationale, data flow diagrams, technology stack justification, directory structure, coding conventions, error handling strategy, logging strategy.
2. **ERD + Database Schema** — 5 pages. Mermaid erDiagram plus table-by-table schema. Planned tables: users, user\_accounts, anonymous\_profiles, consent\_records, language\_variants, words, word\_pronunciations, phonemes, word\_phonemes, phoneme\_example\_words, user\_activity\_events (append-only), user\_word\_states (derived), user\_phoneme\_states (derived), sm2\_states, practice\_sessions, practice\_attempts, word\_requests, audio\_assets.
3. **API Specification (OpenAPI 3.1 YAML)** — 15–20 pages of YAML. Every JSON endpoint documented.
4. **Threat Model** — 8 pages. Component inventory, STRIDE walk-through per component, OWASP Top 10 2021 mapped to controls, project-specific threats.
5. **Security Controls Document** — 10 pages. Per-threat control with code-level detail (middleware names, config values).
6. **Cookie Table + Privacy Policy + KVKK Aydınlatma Metni** — 5 pages combined. Cookie inventory, English privacy policy, Turkish KVKK notice.

#### **Phase 2 — Test & Deploy (before building infrastructure)**

1. **Test Plan** — 10 pages. Pyramid breakdown (70% unit / 20% integration / 10% E2E), tools (Jest, Supertest, Playwright), coverage targets, traceability matrix.
2. **Deployment Diagram + Runbook** — 10 pages. Mermaid deployment topology, Dockerfile and docker-compose.yml design, environment variable catalog, operational procedures.
3. **Risk Register** — 3 pages. Table of risks, likelihood, impact, mitigation, owner.

#### **Open-Source Repo Files (generated at Iteration 0 start)**

README.md, CONTRIBUTING.md, CODE\_OF\_CONDUCT.md (Contributor Covenant 2.1), SECURITY.md, LICENSE (AGPL-3.0 verbatim), .github/ISSUE\_TEMPLATE/bug\_report.md, .github/ISSUE\_TEMPLATE/feature\_request.md, .github/PULL\_REQUEST\_TEMPLATE.md, .github/workflows/ci.yml.

### **Key Decisions Already Locked**

* **License (code):** AGPL-3.0
* **License (content):** CC BY-SA 4.0
* **Initial language variant:** American English (en-us) only for v1.0
* **URL pattern:** pronounceall.com/:variant/:word
* **Audio strategy:** Wiktionary → AI TTS (Google Cloud or Azure free tier) → Web Speech API fallback
* **Phoneme audio:** outsourced one-time recording set for v1.0, Alp K.'s own recordings later
* **Spaced repetition algorithm:** SM-2 (Anki's algorithm)
* **Practice mode:** Self-assessment only, no microphone/ML
* **Save UI:** Single-button Instagram-style with optional tag popover
* **Usernames:** Unique (no discriminator system)
* **Cookie strategy:** Anonymous UUID cookie is strictly necessary and cannot be disabled via the site; ad-personalization cookie (if added) is opt-in
* **Ads:** Opt-in only, off by default
* **Template engine:** EJS (server-rendered, not React)
* **Frontend JS:** Vanilla JS for progressive enhancement
* **Database:** MySQL
* **Deployment:** Docker + Hetzner VPS + Cloudflare + Nginx + Certbot
* **CI:** GitHub Actions (lint + test + security audit on every push)
* **Merge rule for anonymous → registered:** Event log is append-only; latest event per target wins; merging appends an identity\_bindings LINK row and rebuilds derived state; immutable activity events are never re-pointed (B1).
* **Open-source banner:** Dismissable via localStorage, reappears after 30 minutes

**SRS Process Decisions (locked before SRS drafting):**

* Drafting flow: 4 rounds — (1) foundational question batch, (2) §1–3 + all FRs in one pass, (3) all NFRs + traceability matrix, (4) polish pass if needed.
* Questions that cascade into multiple requirements (password policy, session timeouts, rate limits, token expiries, account deletion model, browser floor, performance targets) are resolved *before* drafting, not mid-draft.
* FRs are reviewed in one pass across all areas to catch cross-area inconsistencies, not area-by-area.
* After the SRS is complete, the Completed Documents section will be split into a separate PronounceAll\_Completed\_Documents.md file referenced by the Handoff, so the Handoff stays paste-friendly for subsequent chats.

### **Open Questions (To Resolve During Document Generation)**

These can be settled inside the documents as they are produced:

* Concrete target audience ratio (global vs. Turkish-focused)
* Specific TTS provider choice (Google Cloud vs. Azure vs. AWS Polly) — will be decided in SDD based on current free-tier quotas and licensing
* Phoneme example-word list — will be drafted during SDD using Cambridge/Wiktionary references; ideally reviewed by a phonetician before launch
* Email provider for transactional emails (verification, password reset) — options like Brevo, Resend, SMTP2GO to be evaluated during SDD
* Final wording of privacy policy and KVKK notice — drafted by Claude, ideally reviewed by someone with legal knowledge before go-live
* Exact deployment region on Hetzner (Helsinki, Nuremberg, or Ashburn) — SDD decision
* Password policy (min length, max length cap, complexity) — SRS decision
* Session timeout (idle + absolute) for registered users — SRS decision
* Rate-limit thresholds per endpoint category (auth / read / write) — SRS decision
* Email verification link expiry — SRS decision
* Password reset token expiry — SRS decision
* Account deletion model: immediate hard delete vs. soft delete with grace period vs. hybrid — SRS decision
* Minimum supported browser versions — SRS decision
* Performance targets: TTFB, LCP, CLS numeric thresholds — SRS decision

### **Completed Documents**

*This section will be populated as documents are completed. Each completed document should be appended here in full before starting the next chat.*

**[Project Charter]** — *pending* **[SRS]** — *pending* **[Use Case Diagram + Descriptions]** — *pending* **[SDD]** — *pending* **[ERD + Database Schema]** — *pending* **[API Specification]** — *pending* **[Threat Model]** — *pending* **[Security Controls Document]** — *pending* **[Cookie Table + Privacy Policy + KVKK Aydınlatma Metni]** — *pending* **[Test Plan]** — *pending* **[Deployment Diagram + Runbook]** — *pending* **[Risk Register]** — *pending*

*End of handoff document v1.0. Next step: open a new chat, paste this document, and ask Claude to produce the Project Charter.*