# PronounceAll — Iteration 5 Completion

**Date:** 2026-09-30
**Status:** Iteration 5 (practice / SM-2) — all three slices built and gated;
closure pending the maintainer's review. Next is Iteration 6 (Settings), not started.
**Not specification authority.** Consult `DOC_INDEX.md` first.

---

## 1. What Iteration 5 built

| Slice | What | Commit |
|---|---|---|
| 1 | V11: `sm2_states`, `practice_sessions`, `practice_attempts` (SDD §4.6). SM-2 (right = 5, wrong = 2, EF floor 1.3, UTC second-precision due dates) and the queue rules (learned deferred with p = 0.5; wrong answers back 3–7 turns later) as pure, seeded-tested modules | `85989e9` |
| 2 | `GET /practice` with the three entry states and the read-only upcoming list; sessions with a Redis live queue (60-min idle expiry); `POST /practice/attempt` under `UNIQUE (session_id, turn_seq)`; SM-2 update and `practice_attempt` event in one transaction; completion, resume, timed-out and abandoned finalisation. The word page's pronunciation markup became a shared partial so practice shows the same audio and phoneme controls | `6b2bfa6`, `f2cd68d` |
| 3 | SM-2 follows the merge: on LINK the account's SM-2 state is replayed from every bound identity's `practice_attempt` events in `(occurred_at, event_id)` order, in the LINK transaction; `npm run practice:sweep` finalises sessions idle for 60 minutes | this commit |

Schema is at **V11**. Practice is words only; phoneme practice (FR-PRACTICE-07) is
out of scope for v1.0.

## 2. Closure gate

Lint and licence headers clean; `npm audit` 0 vulnerabilities; **399 unit**, **361
integration**; e2e **140 passed** across Chromium and no-JavaScript, WebKit and
Firefox green apart from the known local harness behaviour (the WebKit playback
replay test and Firefox teardown/crashes, each passing on rerun); word page
11.02 kB of 150 kB.

`6b2bfa6` was committed with its gate red (a lint rule in a test's cleanup and a
reconciliation-suite timeout); `f2cd68d` fixed both without product changes.

## 3. Interpretations recorded

- **FR-PRACTICE-02 statistical test.** The mechanism is implemented as specified
  (a learned head is deferred to the next slot with probability 0.5 when a
  non-learned word is available). Within a finite session every due word is still
  served once, so the "0.5 ± 0.05" acceptance is tested as the per-opportunity
  rate: of ≥ 1 000 turns where a learned word is at the head with an alternative
  behind it, it is served 0.5 ± 0.05 of the time.
- **Leaving the page (FR-PRACTICE-06).** A session left and returned to within
  its 60-minute idle window resumes at the same turn; after that it is finalised
  as timed out on the next visit or by the sweep, as the acceptance criteria for a
  closed tab describe. A reload therefore does not restart a session.
- **Due order.** Due words are served longest-due first: a practised word since
  its `next_due_at`, a never-practised one since it was saved.

## 4. Carried forward

- The scheduled sweep runs with the worker tier (Threat Model F4); until then
  `npm run practice:sweep` and the returning viewer finalise idle sessions.
- A practice link in the site header arrives with the header (Frontend Baseline §6).
- Everything carried by Iterations 3 and 4 (Settings, legal documents, F3–F5, F7).
