# PronounceAll — Iteration 4 Completion

**Date:** 2026-09-30
**Status:** Iteration 4 (authentication) — all four slices built and gated; closure
pending the maintainer's review. Next is Iteration 5 (practice / SM-2), not started.
**Not specification authority.** Consult `DOC_INDEX.md` first.

---

## 1. What Iteration 4 built

| Slice | What | Commit |
|---|---|---|
| 1 | Username registration, Redis sessions validated by `users.session_epoch`, sign-in with one generic error, HIBP check, Turnstile and the Appendix C limits, minimal sign-out, the anonymous → account merge (LINK + latest-event-wins), CSRF bound to the session | `a43dad7` |
| — | Review correction: the post-sign-in identity switch is part of the auth response; a retired `pa_uid` is replaced wherever it is presented; HIBP unavailable is a temporary 503 | `04c8b9c` |
| 2 | Email registration, verification, resend, password reset (ends every session), SMTP adapter with Mailpit for development | `f8ba7ef` |
| 3 | Google sign-in: OIDC code flow with PKCE, single-use browser-bound state, `sub` as the identity, the §5.6 collision rule, pending registration behind a nonce | `742626c` |
| 4 | The registration nudge after 5 anonymous saves (FR-AUTH-17) | this commit |

Schema is at **V10** (`user_accounts`, `auth_tokens`, `consent_records`). No MySQL
sessions table.

## 2. Closure gate

Lint and licence headers clean; `npm audit` 0 vulnerabilities; **378 unit**, **341
integration**; e2e **133 passed** across Chromium and no-JavaScript, **86** Firefox,
**87** WebKit; word page 10.94 kB of 150 kB.

Known local test-harness behaviour on this Windows machine, not product defects:
WebKit runs only with `--workers=1`; `/learnIPA` and one playback test occasionally
crash or time out under full-suite load in WebKit and Firefox and pass on rerun;
Playwright's Firefox stalls on a repeat visit to the same word page, so two
account tests avoid or skip that pattern. Each skip states its reason in the test.

## 3. Deployment requirements recorded

- **Threat Model F7 (accepted):** Nginx and edge access logs must drop the query
  string for `/verify-email`, `/reset-password/confirm` and `/auth/google/callback`.
- Staging and production refuse to boot without real Turnstile, SMTP and Google
  credentials. The production mail provider is not chosen (V5 is provisional).
- A real Google OAuth client must register `APP_BASE_URL` + `/auth/google/callback`
  (locally `http://localhost:3000/auth/google/callback`).

## 4. Carried forward, not Iteration 4

- Settings (Iteration 6): changing email, username or password, account deletion,
  cookie preferences; the sign-out control moves there.
- The site header of Frontend Baseline §6 (the footer "Account" link stands in).
- From Iteration 3: the FR-SAVE-10 production gate (published Privacy Policy and
  KVKK notice — see `notes/Reminder_Legal_Docs.md`), Threat Model F3–F5.
- Phoneme audio is still placeholder and blocks nothing.
