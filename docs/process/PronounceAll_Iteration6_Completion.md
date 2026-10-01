# PronounceAll — Iteration 6 Completion

**Date:** 2026-10-01
**Status:** Iteration 6 (Settings) complete at `f8ad7dc`, **awaiting maintainer review**.
Iteration 7 does not start until it is approved.
**Not specification authority.** Consult `DOC_INDEX.md` first.

---

## 1. What Iteration 6 built

| Slice | What | Commit |
|---|---|---|
| 1 | `GET /settings` for everyone: cookie preferences (essential cookies shown and locked; the ads opt-in recorded in `consent_records` against `PRIVACY_POLICY_VERSION`), the language selector, sign-out, and an account section that explains itself when signed out (FR-SET-01/03/04/05/06/10). The open-source banner in the footer, dismissed for 30 minutes in `localStorage`, no cookie (FR-OSS-01/02) | `5c97e9a` |
| 2 | Change password (current password required; `session_epoch + 1` ends every other session, this device continues on a new one; reset links closed) and change email (V12: the new address held in pending columns, reserved for uniqueness, active only once its link is followed; the old one stays active) (FR-SET-02, FR-AUTH-06/07/11/12) | `c38fbd9` |
| 3 | Account deletion in two steps, restoration by signing in, and the purge job (FR-SET-07/08/09); V13 `deletion_audit`; `CONTACT_EMAIL` | `f8ad7dc` |

`662f24a` patched a new `brace-expansion` advisory (lockfile only, no `--force`; one
path reaches production through `ejs`).

Schema is at **V13**.

### Slice 3 in brief

- **Request (FR-SET-07, SDD §5.5).** Step 1 explains both options and re-authenticates
  with the password, or with a fresh Google round trip (`max_age=0`). Either one issues
  a single-use proof, valid 10 minutes. The proof is bound to the account and to a
  hash of the session, and travels only in the step-2 form. The option and
  `session_epoch + 1` commit together. Redis sessions are cleared after commit. One
  confirmation goes to a verified address, if the account has one.
- **Restore (FR-SET-09).** A correct sign-in inside the window restores the account
  and records `account_restored` in one transaction. This works by password or by
  Google. Past the window, or after a hard delete, sign-in gets the generic failure.
- **Purge (FR-SET-08, SDD §4.9, C6).** A compare-and-set claim gives each account
  exactly one owner. One transaction then:
  - erases the account and every bound anonymous identity, children first;
  - nulls the owners of word requests;
  - writes a tombstone holding only its own id, the type and the time.

  Live practice queues and sessions are cleared after commit, and the job sends no
  email. Tests cover atomicity (a crash after every delete rolls all of it back, and
  a retry finishes), concurrent jobs, and the reuse of the username and email.

## 2. Closure gate (at `f8ad7dc`)

| Check | Result |
|---|---|
| Lint, licence headers | Clean |
| `npm audit` | 0 vulnerabilities |
| Unit tests | 403 passed |
| Integration tests | 413 passed (29 suites) |
| e2e, Chromium and no-JavaScript | 150 passed, 0 failed |
| e2e, WebKit | 95 passed. The two known `/learnIPA` "target closed" crashes fail again; the playback replay test passes on rerun |
| e2e, Firefox | 91 passed. The rest are the known context-teardown error (`_maybeDontRestoreTabs`), plus three axe-core timeouts that pass when run alone. No assertion failed |
| Word page size | 11.49 kB of 150 kB |

## 3. Interpretations recorded

- **What counts as a "fresh Google round trip" (FR-SET-07).** Google's `auth_time` must
  be within 5 minutes, and the ID token must name the signed-in account. The callback
  must also arrive on the session that started the round trip. A Google sign-in that
  is merely still valid does not count.
- **When restoration happens (FR-SET-09).** It happens as soon as the credential is
  proven, before the unverified-email check, so a correct sign-in is never refused
  for an account in its window. Restoration does not move `session_epoch`, because
  the deletion request already ended every session.
- **Cancelling the scheduled job on restore (SDD §5.5).** No job is queued, so there
  is nothing to cancel. The claim's compare-and-set no longer matches a restored
  account, which is the SDD's own safety net.
- **The tombstone's `completed_at`.** This is the moment the erasure transaction
  completes, not the moment of the claim.
- **Choosing no option at step 2.** The proof is not spent, and the same step is
  shown again. A wrong, foreign or used proof sends the person back to step 1.

## 4. Deployment requirements recorded

- **Schedule the purge.** `npm run account:purge-due` must run at least daily to meet
  the 24-hour bound (NFR-PRIV-03). It must run under the `pa_erase` credential
  (SDD §4.9), because the runtime `pa_app` principal holds no DELETE. This stands in
  until the worker tier exists (Threat Model F4).
- **`CONTACT_EMAIL`.** It must be a monitored data-protection mailbox. Staging and
  production refuse to boot without it.

## 5. Carried forward

- The worker tier (F4), which will take over the purge and the practice sweep.
- The dormancy prune of unbound anonymous identities (`deletion_type =
  'dormancy_anonymous'`). The enum value exists; no job writes it yet.
- The legal documents and the real contact mailbox (maintainer, with a lawyer before
  launch).
- Everything carried by Iterations 3–5 (F3, F5, F7, the site header).
- **Local test side effect.** The deletion integration suite runs the purge job, and
  the job erases every due account in the local database. That includes any
  development account deleted through the UI. This is the intended behaviour of the
  job.
