# PronounceAll — SRS Foundational Decisions

**Purpose:** This document captures every decision made during the SRS Round 1 (foundational question batch) so the SRS can be drafted in a fresh chat without re-asking. Paste this alongside the Project Charter and Project Handoff Document when starting the SRS drafting chat.

**Status:** Round 1 complete. Round 2 (§1–3 + all FRs) is the next step.

---

## 1. SRS drafting process

- **Output format:** Markdown (`.md`) file, not `.docx` — for easy git diffing.
- **FR style:** Hybrid — `shall`-statement + MoSCoW priority (Must / Should / Could) + short rationale where non-obvious + acceptance criteria bullet list on non-trivial FRs. Every FR gets a stable ID like `FR-WORD-01`, `FR-AUTH-07`.
- **Trivial FRs** get only shall-statement + priority, no padding.
- **Remaining rounds:** Round 2 = §1–3 + all FRs; Round 3 = all NFRs + traceability matrix; Round 4 = polish.
- Questions that cascade across multiple FRs are all resolved below — do not ask them again during drafting.

---

## 2. Security posture

- **Standard:** OWASP ASVS v5.0.0, Level 2 (stricter than baseline). The project pins to v5.0.0 as its long-term security-verification baseline; future ASVS revisions will be evaluated as a deliberate maintenance task rather than tracked continuously. Explain every control inline as it appears in the SRS.
- **Password policy:** min 8 chars, max 100 chars, no complexity rules (no forced uppercase/number/symbol — NIST SP 800-63B Rev 3 §5.1.1.2 explicitly advises against them). Checked against Have I Been Pwned via k-anonymity (only a 5-char SHA-1 prefix leaves the server). Bcrypt cost factor 12. Policy intentionally mirrors Google consumer Gmail's password policy, which sits at the NIST §5.1.1.2 floor (length, no composition, breach screening). The project pins to NIST SP 800-63B Rev 3 as its long-term password-guidance baseline; future revisions of the standard will be evaluated as a deliberate maintenance task rather than tracked continuously, consistent with the ASVS pinning posture in this section.
- **Session tokens:** 30 min idle timeout / 12 h absolute timeout. Rotated on login and on password change.
- **Email verification link:** 24 h expiry, single-use.
- **Password reset token:** 1 h expiry, single-use, invalidated on use and on any password change from any device.
- **Auth error messages:** generic ("invalid credentials"), never "user not found" or "wrong password".
- **CSP:** with nonces, no `unsafe-inline`. HSTS preload. SRI on any third-party script.
- **Redis-backed rate-limit store** in production (Docker may scale to multiple Express instances behind Nginx).

---

## 3. Audience and legal regime

- **Audience:** Global / EU-first. English is the primary UI language.
- **Primary legal regime:** GDPR drives defaults.
- **Secondary:** KVKK is satisfied as a side-effect. Turkish translation of legal notices (privacy policy, KVKK Aydınlatma Metni) remains, no other Turkish UI.
- No i18n infrastructure for v1.0 beyond the two static legal pages.

---

## 4. Performance targets

- **Floor:** Core Web Vitals "Good" — LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms. All pages.
- **Stretch target:** word pages LCP ≤ 1.5s (they're essentially static text).
- **Lighthouse ≥ 90** across Performance, Accessibility, Best Practices, SEO (already locked in Charter).
- **Phoneme audio strategy:** preload on word pages (5–10 files per word, negligible weight); lazy-load on both `/learnIPA` (the global page) and `/:variant/learnIPA` (the per-language page) — preloading the full phoneme set on either would be too heavy.
---

## 5. Browser support floor

- **Minimum:** 2022+ evergreens (Chrome, Firefox, Safari, Edge). ~99% coverage.
- **Layout primitive:** Flexbox-first. Grid used only where Flex would require deep nesting and harm readability (e.g., 2D settings layouts).
- **Progressive enhancement:** word-page reading must work without JavaScript. Interactive features (IPA click-to-play, save popover, practice session) require JS and target the 2022+ baseline.
- **Safe modern features:** CSS `:has()`, `aspect-ratio`, optional chaining, nullish coalescing, top-level await in modules.
- **Avoid:** CSS anchor positioning, View Transitions, Grid subgrid (unless graceful fallback is trivial).

---

## 6. Anonymous identity (pre-login progress)

- **Primary store:** UUID cookie. `Max-Age` = 2 years. Sliding renewal on every request (`Max-Age` reset on each visit).
- **Backup store:** mirror the UUID to `localStorage` on the same origin. On every request, if cookie is missing but `localStorage` has a UUID, rehydrate the cookie from it before processing the request.
- **Rationale:** self-healing against "clear cookies" tools that leave `localStorage` intact; no new privacy surface because our own code writes both.
- **Threat Model note:** UUID in `localStorage` is JS-accessible on our origin. Acceptable because any XSS capable of reading `localStorage` would also read the cookie (we cannot set HttpOnly because the client JS needs to read it for rehydration). Document this tradeoff.
- **Registration nudge:** one-time, dismissible, triggered after the user has 5+ saved items. Wording: "Create an account so you never lose your progress." Dismissal stored in `localStorage`.
- **Not doing:** IP-based identity (unreliable + GDPR-sensitive), fingerprinting (contradicts privacy stance), magic-link self-recovery (registration covers it).
- **Read-only fallback:** users with cookies globally disabled see a read-only site — word pages render, save buttons show an "enable cookies to save progress" message. No degraded state stored.

---

## 7. Registration — three paths

All three paths produce one `users` row with a unique `user_id`. Each path merges the current anonymous UUID profile on first successful login.

| Path | Required fields | Email verification |
|------|-----------------|---------------------|
| **Google OAuth** | Google identity + unique username chosen on first login | Not needed (Google already verified) |
| **Email + password** | email + password + unique username | **Required before first login.** Account exists but cannot be used until the 24h verification link is clicked. |
| **Username-only** | unique username + password; optional email | **Required if email provided** (same 24h flow). If no email given, user must tick an acknowledgement checkbox: "Without an email, we cannot recover your account if you forget your credentials. You accept this risk." This tick is logged in `consent_records`. |

**Username rules:** unique (case-insensitive comparison), 3–20 chars, `[a-zA-Z0-9_-]`, must start with a letter. No discriminator system.

**Email rules:** unique across all accounts that have an email (whether verified or pending verification). If user B tries to register with or add an email already used by user A, reject with "this email is already associated with another account."

**Recovery possibilities:**
- Google path: recover via Google.
- Email path: recover via verified email.
- Username-only path + verified email: recover via that email.
- Username-only path, no email: no recovery possible. User was warned and accepted.

---

## 8. Account deletion (GDPR Art. 17 — Right to Erasure)

Two-step flow from Settings → Delete account:

1. **Confirmation screen** explains both options.
2. **User picks one:**
   - **Soft delete (default, recommended):** account disabled, login blocked, profile hidden. Data retained 30 days. Logging back in during the window fully restores the account. After 30 days, hard delete runs automatically via a scheduled job.
   - **Delete immediately (hard delete):** irreversible. Personal data purged within 24h. Account row replaced with a tombstone referencing a deletion ID (for audit only, no PII).
3. **Re-authentication required** before either option takes effect (password re-entry, or fresh Google OAuth round-trip). Prevents session-hijacking attacks from deleting accounts.
4. **Confirmation email** sent on completion, with a "this wasn't me" contact link for the soft-delete case.

What gets deleted under hard delete: `users` row, `user_accounts` rows, `user_word_states`, `user_phoneme_states`, `sm2_states`, `practice_sessions`, `practice_attempts`, the user-tied subset of `user_activity_events`, `consent_records`, session rows.

What's preserved: anonymised aggregate counts only (if any). Word requests the user submitted become ownerless (no `submitted_by_user_id`).

30 days is the maximum reasonable soft-delete window under GDPR practice.

---

## 9. Bot protection — Cloudflare Turnstile

- **Applied on:** `/register`, `/login`, `/reset-password`, `/request-word`.
- **How it works:** JS widget runs invisible challenges in the browser (tiny proof-of-work, browser-consistency checks, Cloudflare's reputation signals) and issues a single-use token (~5 min expiry). On form submit, our server verifies the token via Cloudflare's API. No cross-site tracking, no image puzzles, no personal data. Fails back to a visible checkbox for suspicious traffic; never a picture puzzle.
- **Rejected alternatives:** Google reCAPTCHA (cross-site tracker), image CAPTCHAs (inaccessibility + solved by bots).

---

## 10. Rate limiting

### 10.1 Why we rate-limit

Each limit maps to a concrete threat. Without the limit, the attack works.

| Threat | Prevented by |
|--------|--------------|
| Credential stuffing (leaked password lists against `/login`) | login limit |
| Password-reset inbox flooding | reset-per-email limit |
| Signup spam (bot-created junk accounts) | register limit |
| Word-request spam | word-request limit |
| Event-log bloat from malicious save spam | save/tag limit |
| Content scraping / bandwidth exhaustion | word-page read limit |
| DDoS baseline | Cloudflare edge rule |

### 10.2 How we identify one "user" for counting

In order of preference — use the first available:

1. **Session `user_id`** if logged in.
2. **Anonymous UUID cookie** if present.
3. **IP address** as fallback (pre-cookie requests) and as a *secondary* safety net alongside 1/2 to catch cookie-rotation botnets.
4. **Email address** for email-specific limits (password reset, verify-email-resend) — prevents cookie + IP rotation from still flooding one victim's inbox.

### 10.3 The limits

| Endpoint | Limit | Identity key | Purpose |
|----------|-------|---------------|---------|
| `POST /login` | 5 per 15 min | cookie UUID + IP | credential stuffing |
| `POST /register` | 3 per 1 h | IP | signup spam |
| `POST /reset-password` | 3 per 1 h | email address | inbox flooding |
| `POST /verify-email/resend` | 3 per 1 h | account ID | same |
| `POST /request-word` | 10 per 1 h | cookie UUID | content spam |
| Save/tag events (POST) | 60 per 1 min | cookie UUID | write spam |
| `GET` word pages | 120 per 1 min | cookie UUID | scraping |
| All endpoints (edge) | 1000 per 1 min | IP (Cloudflare WAF) | DDoS baseline |

On breach, respond with HTTP 429 and a `Retry-After` header. Counter store: Redis in production, in-memory acceptable for dev only.

Cloudflare WAF rule is configured at the edge and enabled from day one.

---

## 11. Quick decisions summary (for cross-referencing during drafting)

| Topic | Decision |
|-------|----------|
| Security standard | OWASP ASVS v5.0.0, Level 2 (long-term pin) |
| Legal primary | GDPR (KVKK side-effect) |
| Perf floor | CWV "Good"; word pages stretch LCP ≤ 1.5s |
| Browser floor | 2022+ evergreens; Flex-first |
| Password | 8 chars min, 100 chars max, HIBP-checked, bcrypt cost 12, no composition rules (mirrors Gmail) |
| Session | 30 min idle / 12 h absolute |
| Email verification | 24 h, single-use |
| Password reset | 1 h, single-use |
| Anon ID | UUID cookie (2yr sliding) + `localStorage` mirror + nudge after 5 saves |
| Registration | 3 paths: Google, Email+verify, Username±email |
| Email uniqueness | Required across all accounts that have one |
| Deletion | Soft (30d grace) default, hard option, re-auth required |
| Bot protection | Cloudflare Turnstile on 4 endpoints |
| Rate limits | Per table in §10.3; Redis store |
| FR style | Hybrid shall + MoSCoW + rationale + acceptance criteria |
| Output | `.md` file |

---

## 12. Still-open items (for later rounds, not blocking Round 2)

These were flagged in the Handoff as deferrable to the SDD, not the SRS:

- TTS provider choice (Google Cloud vs. Azure vs. AWS Polly).
- Transactional email provider (Brevo, Resend, SMTP2GO).
- Hetzner region (Helsinki, Nuremberg, Ashburn).
- Phoneme example-word list (drafted in SDD using Cambridge/Wiktionary references).

The SRS can reference these abstractly ("the system shall use a transactional email provider that…") without naming a vendor.

---

*End of SRS foundational decisions. Next chat: paste Charter + Handoff + this file, then instruct Claude to produce SRS Round 2 (§1–3 + all FRs).*
