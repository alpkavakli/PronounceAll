# PronounceAll — Iteration 3 Completion

**Date:** 2026-09-29
**Status:** Iteration 3 (save/tag) **CLOSED** at `5ff770b`. Next is Iteration 4
(accounts), not Iteration 5.
**Not specification authority.** Consult `DOC_INDEX.md` first.

---

## 1. What Iteration 3 built

| Slice | What | Commit |
|---|---|---|
| 1 | Save and tag words and phonemes, with and without JavaScript; append-only event log, derived state, hydration read, CSRF (SDD §6.6), idempotency, rate limit | `d8367d6`, `b89e9c3` |
| 2 | Learned-phoneme presentation, `/learnIPA` progress and filter, the word-page progress banner | `47af631` |
| 3 | `1× / 0.75×` playback speed, the Broad en-US IPA label, `POST /listen` events | `a795e26` |
| — | FR-SAVE-04 reconciliation and the FR-SAVE-06 cookies-refused test | `e2159ae` |
| — | Threat Model F1 (CSRF on `/request-word`), F2 (search text out of application logs), F6 (`Permissions-Policy`) | `bfa5b69` |
| 4 | Word encounters (FR-SAVE-10): `POST /encounter`, one per owner, word and UTC day by the V9 unique key | `5ff770b` |

Schema is at **V9**.

## 2. Closure gate at `5ff770b`

Lint and licence headers clean; **317 unit**, **234 integration**; e2e **196 passed**
across Chromium, Firefox and no-JavaScript, **76 passed** on WebKit; word page 10.38 kB
of its 150 kB budget.

WebKit on this Windows machine runs only with `--workers=1`; with more it crashes the
browser. One WebKit layout test failed once and passed 12 of 12 on repeat: an
intermittent WebKit flake, not a code failure. The failed-load listen test is skipped
on WebKit, because `page.route` cannot intercept WebKit media requests; Chromium and
Firefox still assert it.

## 3. Carried forward, not Iteration 3

- **FR-SAVE-10 production release gate:** encounter recording must not be enabled in
  production until the Privacy Policy and the KVKK notice are published with the owner
  facts filled in. Legal bases are accepted for building; a lawyer reviews them before
  public launch. The maintainer's checklist is in `notes/Reminder_Legal_Docs.md`
  (a personal note, not committed).
- The `/privacy` and `/kvkk` routes themselves (FR-CONSENT-05).
- Threat Model F3 (least-privilege database principals, SDD §4.9), F4 (the worker
  tier: dormancy prune, hard delete, scheduled reconciliation), F5 (error tracker).
- Phoneme audio is still placeholder: the maintainer will record it, and it blocks
  nothing.
