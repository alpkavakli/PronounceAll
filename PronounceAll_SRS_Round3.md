# PronounceAll — SRS Round 3 additions

**Version:** 0.3 (Round 3 draft: all NFRs + traceability matrix + appendices)
**Status:** Draft — pending Round 4 polish
**Supersedes/extends:** SRS v0.2 (Round 2). This file contains §5, §6, §7 only. Merge after §4 in the v0.2 file to obtain the complete SRS v0.3.
**Owner:** Alp K.
**Derived from:** Project Charter v1.0, Project Handoff Document v1.0 (Feature Brief v0.1 Locked), SRS Foundational Decisions (Round 1), SRS v0.2 (Round 2).

---

## Merge instructions

Paste §5, §6, and §7 below into the v0.2 SRS file immediately after `### 4.9 Content & data seeding — FR-CONTENT-*` and before the `*End of Round 2 draft…*` footer line. Then delete that footer. The result is SRS v0.3.

Round 4 (polish) will: re-verify all cross-references, tighten prose, ensure every FR still cited in §6 exists in §4, fold a final pass of the reserved-username list back into FR-AUTH-05, and produce a clean table of contents covering §1–§7.

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

All public traffic shall be served over TLS. The Cloudflare edge shall enforce TLS 1.2 minimum with TLS 1.3 preferred, modern cipher suites only (no RC4, no 3DES, no CBC-mode ciphers in TLS 1.2 negotiation), HSTS enabled with `max-age ≥ 15552000` (six months), `includeSubDomains`, and `preload`. The origin-facing connection between Cloudflare and the VPS shall use a valid certificate provisioned by Certbot.

**Rationale:** Foundational Decisions §2 requires HSTS preload. Cloudflare's defaults cover the cipher side cleanly; the NFR fixes them explicitly so a future configuration drift is catchable.

**Acceptance criteria:**
- `curl -sI https://pronounceall.com/` returns an HSTS header matching the rule above.
- `testssl.sh` (or equivalent) against the production host reports no findings above "LOW".
- The domain is present on the HSTS preload list or the application has submitted for inclusion before launch.

#### NFR-SEC-03 — Content Security Policy. *Priority: Must.*

Every HTML response shall carry a Content-Security-Policy header with, at minimum: `default-src 'self'`, `script-src 'self' 'nonce-<per-request>'` (no `unsafe-inline`, no `unsafe-eval`), `style-src 'self' 'nonce-<per-request>'`, `img-src 'self' data:` (as tight as asset strategy allows), `media-src 'self'`, `connect-src 'self' https://api.pwnedpasswords.com https://challenges.cloudflare.com`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, `upgrade-insecure-requests`.

**Rationale:** Foundational Decisions §2 — CSP with nonces, no `unsafe-inline`. Per ASVS v5.0.0-3.4.6, the CSP `frame-ancestors` directive is the required mechanism for clickjacking protection; the `X-Frame-Options` header is treated by the standard as obsolete and not relied upon.

**Acceptance criteria:**
- Inline `<script>` or `<style>` without a nonce fails to execute in the browser.
- A Playwright test asserts the presence of every listed directive on `/`, `/en-us/cupcake`, `/learnIPA`, `/register`, `/login`, `/settings`, `/privacy`, `/kvkk`.
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

Every public page shall meet Core Web Vitals thresholds in the "Good" range: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms, measured on a 4G throttled profile on the 2022+ evergreen baseline. Pages in scope: `/`, `/:variant/:word`, `/learnIPA`, `/register`, `/login`, `/settings`, `/privacy`, `/kvkk`, `/practice`, the 404 word page.

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

**Rationale:** Cloudflare edge caching will mask origin variability for most readers; the origin budget still matters for the first fetch of each word.

**Acceptance criteria:**
- Synthetic RUM from the k6 load test reports p95 origin TTFB within the budget under the test load.
- A probe from a neutral region (e.g. Frankfurt if origin is Nuremberg) is run monthly.

#### NFR-PERF-05 — Database query budget on word-page composition. *Priority: Should.*

Composing a word page (all queries: word + pronunciations + phoneme joins + user state + progress banner count) shall complete in ≤ 50 ms (p95) against a database loaded with the launch dataset. The query plan shall be reviewed in the SDD and relevant indexes declared in the ERD.

**Acceptance criteria:**
- An instrumented integration test measures total DB time for rendering `/en-us/cupcake` and asserts the budget.

#### NFR-PERF-06 — Phoneme audio latency. *Priority: Must.*

Phoneme audio playback latency from click to audible playback shall meet the target defined in FR-IPA-04. This NFR exists to locate the performance-budget statement alongside the other performance targets; the normative source is FR-IPA-04.

#### NFR-PERF-07 — Page weight budget (HTML + critical CSS + core JS). *Priority: Should.*

Each word page's initial document (HTML) plus its critical CSS and core JavaScript shall be ≤ 150 KB gzipped, excluding audio and fonts. The `/learnIPA` page's budget is ≤ 200 KB under the same exclusions. Budgets are enforced by a size-limit check in the CI pipeline.

**Rationale:** The strongest single lever on LCP, INP, and "Best Practices" audits alike.

**Acceptance criteria:**
- `size-limit` (or equivalent) is configured and the CI step fails if any bundle exceeds its budget.

#### NFR-PERF-08 — Pre-launch load test. *Priority: Must.*

Before v1.0 launch the system shall sustain, for 10 minutes, the expected-peak profile of 50 concurrent anonymous visitors each paging through 5 word pages per minute, plus 5 concurrent logged-in users each running one practice session, without exceeding: origin CPU 70 %, origin memory 70 % of allocated, error rate 0.5 %, p95 origin TTFB per NFR-PERF-04.

**Rationale:** Charter §5 — hardening includes load testing. The target load is modest because v1.0 is a solo-dev public launch; Cloudflare absorbs burst.

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
| Event log rows owned by an anonymous UUID | **Pruned when the UUID has been dormant for 2 years** (matches the cookie's max sliding lifetime) | GDPR Art. 5(1)(e) storage limitation |
| Session rows (`pa_sid`) | Idle 30 min / absolute 12 h (per FR-AUTH-12), pruned nightly | Per Foundational Decisions §2 |
| Email-verification tokens | 24 h (per FR-AUTH-09), pruned nightly after expiry | Security |
| Password-reset tokens | 1 h (per FR-AUTH-11), pruned nightly after expiry | Security |
| Soft-deleted accounts | 30 days (per FR-SET-07), then hard-deleted | Foundational Decisions §8 |
| Access logs (at Cloudflare + origin) | 30 days | Ops troubleshooting without over-retention |
| Application logs (origin) | 30 days | Same |
| Backups (daily snapshots) | 30 days rolling | NFR-OPS-01 |
| Consent records | Retained as long as the account exists; deleted with hard-delete | GDPR Art. 7(1) demonstrability |
| Deletion-audit tombstones (no PII) | Retained indefinitely | Audit |

**Rationale:** GDPR Art. 5(1)(e). The 2-year anonymous dormancy figure is an inline decision matching the cookie's maximum sliding lifetime (Foundational Decisions §6); flagged for review in the Round 3 drafting notes.

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

The Threat Model shall include a data-flow diagram listing every third party the system exchanges personal data with and what is exchanged: Google OAuth (email, sub, profile picture URL on login), Cloudflare edge (IP, request metadata, Turnstile token payload), HIBP (SHA-1 prefix only — first 5 hex chars), transactional-email provider (recipient email address + token URL). No other data leaves the origin.

**Acceptance criteria:**
- The Threat Model's DFD enumerates exactly this list.
- Any change to the list requires an update here, in the Privacy Policy, and in the Threat Model in the same PR.

### 5.5 Operations — `NFR-OPS-*`

#### NFR-OPS-01 — Automated backups. *Priority: Must.*

MySQL shall be backed up by a nightly `mysqldump` (logical backup) with gzip compression, pushed to off-site object storage (S3-compatible) with server-side encryption. Retention: daily snapshots for 30 days; weekly snapshots for 26 weeks. The backup job's failure shall page the maintainer.

**Rationale:** Charter §5 (hardening includes automated backups); the daily + weekly scheme is the standard DR balance for a small dataset. Flagged for cost review in the Round 3 drafting notes.

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

Origin application and access logs shall be retained for 30 days, then rotated out. Logs shall never be stored beyond that window for any non-security reason. Security-relevant incident logs may be retained longer when tied to a specific investigation; such retention is documented in the Runbook per incident.

**Rationale:** GDPR storage limitation; balance with operational needs.

#### NFR-OPS-05 — Reproducible deployment. *Priority: Must.*

A fresh Hetzner VPS with the documented OS image shall be bootstrapable into a running PronounceAll production host by following the Runbook's deployment procedure, which consists solely of shell commands and the repo itself. No undocumented manual step shall be required.

**Rationale:** Solo-dev operability — any step that exists only in the maintainer's head is an availability risk.

**Acceptance criteria:**
- Dry-run rehearsal on a throwaway VPS before launch succeeds without deviation from the Runbook.
- The rehearsal is repeated after any non-trivial infrastructure change.

#### NFR-OPS-06 — Availability target. *Priority: Should.*

PronounceAll v1.0 targets **best-effort availability** with no contractual SLA. The maintainer commits to acknowledging outages within 24 hours of awareness and restoring service as fast as reasonably possible. Known-maintenance windows are announced via the GitHub repo's issue tracker.

**Rationale:** A solo-dev open-source project must not promise 99.9 %. An honest "best effort" posture is the correct one for v1.0.

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

The URL pattern `/:variant/:word` and the `language_variants` table structure shall be designed so that adding a new variant (`en-gb`, `fr-fr`) is a data change plus a phoneme-table and dictionary-ingestion exercise, not a code refactor. UI strings that would later be translated shall be centralised in a single module per route (kept simple; no i18n framework) so a future contribution can wire in one.

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

---

## 7. Appendices

### Appendix A — Reserved usernames

FR-AUTH-05 requires that reserved usernames be rejected at registration. The list below is the launch baseline; additions may be made by an internal-only config file committed to the repo. Matching is case-insensitive.

Administrative / role-like: `admin`, `administrator`, `root`, `superuser`, `sysop`, `staff`, `owner`, `maintainer`, `moderator`, `mod`, `support`, `help`, `billing`.

Technical / route-collision risks: `api`, `app`, `www`, `mail`, `email`, `ftp`, `ssh`, `static`, `assets`, `cdn`, `media`, `img`, `images`, `audio`, `video`, `files`, `download`, `upload`.

PronounceAll-specific routes or concepts: `settings`, `account`, `profile`, `login`, `logout`, `register`, `signup`, `signin`, `reset-password`, `verify-email`, `privacy`, `kvkk`, `about`, `contact`, `terms`, `legal`, `cookies`, `learnipa`, `practice`, `search`, `word`, `words`, `phoneme`, `phonemes`, `ipa`, `en-us`, `en-gb`, `fr-fr` (and any future variant code).

Abuse / impersonation deterrents: `pronounceall`, `anthropic`, `claude`, `google`, `cloudflare`, `system`, `null`, `undefined`, `anonymous`, `deleted`, `user`.

The list is maintained in a single source-controlled file. Adding a new route to the application triggers an implied addition to this list; the Runbook documents the procedure.

### Appendix B — Phoneme example-word list

Deferred to the SDD, per Handoff Open Questions. The list is drafted in the SDD using Cambridge and Wiktionary references and ideally reviewed by a phonetician before launch. The seed script (FR-CONTENT-02) populates `phonemes` and `phoneme_example_words` from this list.

Approximate count: 43–45 phonemes for `en-us` (FR-IPA-01). The SDD shall pin the exact count and list.

### Appendix C — Rate-limit quick reference

Normative source: Foundational Decisions §10.3, enforced by FR-AUTH-15 (authentication endpoints), FR-WORD-05 (word-request), FR-SAVE-08 (idempotency bucket infrastructure), and NFR-SEC-11 (Redis-backed store). Reproduced here for ease of audit.

| Endpoint | Limit | Identity key | Primary FR/NFR |
|----------|-------|--------------|----------------|
| `POST /login` | 5 / 15 min | UUID + IP | FR-AUTH-15 |
| `POST /register` | 3 / 1 h | IP | FR-AUTH-15 |
| `POST /reset-password` | 3 / 1 h | email address | FR-AUTH-15 |
| `POST /verify-email/resend` | 3 / 1 h | account ID | FR-AUTH-10 / FR-AUTH-15 |
| `POST /request-word` | 10 / 1 h | UUID | FR-WORD-05 |
| Save/tag POSTs | 60 / 1 min | UUID | FR-SAVE-09 (audio_listen implied) |
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
- `GET /learnIPA` — phoneme index (FR-IPA-07).
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

## Round 3 drafting notes

**Inline decisions made during Round 3.** These are judgement calls where Foundational Decisions, Charter, and Handoff did not pin the value. Flag any to revise before Round 4 polish; each is documented at the point of use so changing it is a single-location edit.

1. **NFR-PRIV-02 — anonymous profile dormancy = 2 years.** Matches the `pa_uid` cookie's sliding max lifetime (Foundational Decisions §6). Alternatives: 1 year (tighter privacy, but evicts seasonal learners); 3 years (looser). Current pick aligns retention with the cookie and is the cleanest story in the Privacy Policy.
2. **NFR-OPS-01 — backups: daily × 30 days + weekly × 26 weeks.** Standard DR baseline for small datasets. If off-site storage cost becomes an issue, cut to weekly × 13 weeks. If a formal RPO is later set, revisit.
3. **NFR-OPS-04 — log retention = 30 days.** Balances ops utility against storage. Adjust up to 90 days if incident response needs it; longer than 90 days runs into GDPR storage-limitation friction without a security rationale.
4. **NFR-SEC-02 — HSTS `max-age = 15552000` (6 months) with preload.** Standard preload threshold. Consider starting with 1 month and stepping up pre-launch to minimise lock-in while configuration churns.
5. **NFR-PERF-04 — origin TTFB p95 = 200 ms cached / 400 ms uncached.** Modest, reflects a single VPS origin. Tighten after real baselines are measured in load testing.
6. **NFR-PERF-05 — DB query budget = 50 ms p95 on word-page composition.** Reasonable for indexed reads against MySQL 8 at launch volume. If the seed dataset grows 10×, revisit.
7. **NFR-PERF-07 — page weight budgets: 150 KB word page / 200 KB `/learnIPA`.** Excludes audio and fonts (which are cacheable and often preloaded). Intended to force discipline rather than match an industry average.
8. **NFR-PERF-08 — load-test profile: 50 concurrent anonymous + 5 concurrent practicing users × 10 min.** Intentionally modest for a public-launch solo-dev project. Scale up if marketing plans change.
9. **NFR-OPS-06 — availability target: best-effort, no SLA.** Deliberately honest. Any commitment beyond this requires another pair of hands.
10. **Appendix A — reserved-username list.** Drafted inline. Not exhaustive; extending via a config file is cheap. The list deliberately blocks known route collisions, role impersonation, and brand squatting targets.
11. **Appendix E — PII field inventory.** Treated as the canonical field list; the ERD (next document) must reconcile to it. If the ERD introduces a field not in Appendix E, the ERD's PR shall also update Appendix E.
12. **Traceability matrix — Charter SC "—" entries.** Any FR/NFR marked "—" under Charter SC serves supporting goals (robustness, operability, input hygiene) rather than a named Charter criterion. Absence of a Charter number is not absence of purpose.
13. **"TM pending" annotations.** Used instead of speculating about threat-model entry IDs before the Threat Model exists. Round 4 polish can re-sweep these once the Threat Model is drafted.

**Items deliberately left for Round 4 polish:**

- Round 4 re-sweeps every cross-reference (FR-XX-YY → target still exists?).
- Round 4 folds in any of the Round 2 inline decisions the maintainer revisits (SM-2 quality mapping, seed floor at 5 000 words, etc.).
- Round 4 produces a full top-level table of contents covering §1–§7.
- Round 4 tightens wording for consistency and eliminates any remaining "shall be designed so that…" phrasings in favour of testable "shall …".

**Items correctly pushed to downstream documents (not Round 4):**

- Phoneme example-word list (Appendix B) — SDD.
- TTS provider, transactional-email provider, Hetzner region — SDD.
- Exact ASVS L2 control crosswalk — Threat Model.
- GDPR article-by-article crosswalk — Threat Model (referenced by NFR-LEGAL-01).
- OpenAPI endpoint catalogue — API Specification.
- Final Privacy Policy and KVKK wording — Cookie Table + Privacy Policy + KVKK doc (Phase 1 document).

---

*End of SRS Round 3 additions. Next step: paste as the completed SRS (merged with Round 2) into the Handoff's Completed Documents section. Then either (a) proceed to Round 4 polish in a focused chat, or (b) begin the next document in the Handoff's sequence: the Use Case Diagram + Descriptions.*
