# PronounceAll — Session Handoff, 2026-09-29

**Status:** Current resume point. Supersedes
`PronounceAll_Session_Handoff_2026-09-16.md` for current state; that document stays
accurate for the IPA-quality history it records.
**Head:** `3c61600`, `main`, working tree clean, 14 commits ahead of `origin/main`.
**Not specification authority.** Consult `DOC_INDEX.md` first, as always.

---

## 0. Where the project is, in five lines

- IPA quality is **closed**: syllabification and source normalization are both done
  and are not to be reopened.
- **Iteration 3 (save/tag)** is three slices of four complete and tested.
- The last slice, **word encounter recording**, is written but deliberately NOT built:
  it waits behind a privacy gate.
- That gate is **one review by you** of three drafts, plus four answers (§2).
- Nothing is blocked on code. Everything is blocked on those answers.

---

## 1. What is built and working

Iteration 3 is the save/tag iteration of the frozen roadmap (Iteration 4 is accounts,
Iteration 5 is practice/SM-2). Slices 1–3 plus the two completion items are done:

| Slice | What works today | Commit |
|---|---|---|
| 1 | Save and tag words and phonemes: one control on the word page, in the phoneme popover and on every `/learnIPA` row. Four states (unsaved / saved / learning / learned). Works with JavaScript (button + tag menu) and without it (a confirmation page then a redirect back). Append-only event log, derived state, hydration read, CSRF, idempotency, rate limit | `d8367d6`, `b89e9c3` |
| 2 | Learned phonemes render green with an underline; everything not yet learned renders muted; before hydration and without JavaScript nothing is asserted. The word-page banner shows `M/N — doing great! K to go`; `/learnIPA` shows `M / N learned` with an All / Learned / Not learned yet filter | `47af631` |
| 3 | `1× / 0.75×` playback speed for whole-word audio, phoneme audio and Web Speech (in memory only, never persisted). The "Broad en-US IPA" label with an accessible disclosure. `POST /listen` events, recorded only when playback actually starts and only for learners who already have progress | `a795e26` |
| — | FR-SAVE-04 reconciliation (dry run and repair) and the FR-SAVE-06 cookies-refused browser test | `e2159ae` |

**Gate at this head:** lint clean, licence headers in 155 files, **310 unit**, **208
integration**, **112 Chromium + no-JavaScript e2e**, word page 10.38 kB gzipped of its
150 kB budget. Firefox and WebKit e2e have not been run in this stretch.

---

## 2. The only thing blocking progress: your review

Slice 4 (word encounters) may not be enabled until the FR-SAVE-10 release gate is
met. Three drafts are waiting, written from specified behaviour only:

- `docs/current/PronounceAll_Privacy_Policy_EN_DRAFT.md`
- `docs/current/PronounceAll_KVKK_Aydinlatma_Metni_TR_DRAFT.md` (same facts, Turkish)
- `docs/current/PronounceAll_Threat_Model_v0.1_DRAFT.md`

**Four answers needed:**

1. **Facts only you have:** data controller name and postal address, contact email
   address, publication date.
2. **Legal:** confirm the proposed legal bases; decide whether a lawyer reviews
   international transfers (EU hosting is an export under KVKK Art. 9) and the GDPR
   Art. 27 EU-representative question now or before launch.
3. **Search terms in logs.** Request logging records full URLs, so `/search?q=…`
   puts search text in application and access logs for every visitor, unlinked to any
   profile. Either publish the policy wording as drafted, or strip query strings from
   application logs first (small change).
4. **Two findings — fix before Iteration 3 closes, or later?**
   - `POST /request-word` carries no CSRF token although FR-AUTH-20 covers every
     state-changing POST (Turnstile and a rate limit still guard it);
   - the `Permissions-Policy` header is not sent at all. Every other required
     security header is.

What the encounter feature will do once approved, already specified in FR-SAVE-10 and
drafted in the policies: record the canonical `word_id` and time, at most once per
word per UTC day, only for a registered user or an anonymous learner who already has
a progress profile; never a search string, a failed search or a referrer; a passive
reader gets no profile and no history.

---

## 3. Decisions that are FROZEN — do not reopen

1. **IPA quality is closed.** Syllabification closed at `9e9e374`; source
   normalization closed at `d0c85ba` (zero defects across 7 511 pronunciations). No
   further corpus validation, no new syllable rules, no ipa-dict cycle now.
2. **D4 and the 41-unit inventory.** Unchanged. `ɔʊ̯ → oʊ` (§5.2) and the CMUdict
   profile (§5.8) were added as ordinary source-profile content changes.
3. **Phoneme audio is placeholder.** All 41 clips are Piper output the maintainer
   judged wrong; he will record real ones himself. **Reconfirmed 2026-09-29: still
   unresolved, explicitly not urgent.** Do NOT run audio QA, Piper draws, Commons
   fetches or promotions, and do not treat this as a blocker for anything.
4. **CSRF scheme (SDD §6.6).** Stateless HMAC over `csrf:v1:anon:<pa_uid>` under
   `CSRF_SECRET`, issued only on uncached per-viewer responses, constant-time compare,
   same-origin check, no cookie. No-JavaScript writes go through an uncached
   confirmation page. Settled; do not weaken for convenience.
5. **The roadmap is not re-sequenced.** Iteration 3 save/tag, 4 accounts, 5
   practice/SM-2. Encounters are recorded in 3 and only turned into review in 5.
6. **Learner state is a projection.** `learned` is the FR-SAVE tag; there is no second
   mastery flag or table. Gray has no underline on purpose — the underline is what
   makes *learned* distinguishable without colour.
7. **`ipa_transcription` is never rewritten for display.** Structure goes in
   `syllable_breakdown`.
8. **Post-v1.0, not now:** microphone/self-recording (the SRS, the security headers
   and the Charter all forbid it), pronunciation scoring, search-derived phoneme
   analytics, OCR, UK IPA, heavy games.

---

## 4. If you approve the drafts, the remaining work is small

1. Answer §2. Fix or defer the two findings.
2. **Slice 4:** a migration adding the per-day unique key for `word_encounter`, a
   `POST /encounter` route mirroring `/listen`, the hydration eligibility flag (the
   `recordsHistory` field already exists), and tests for eligibility, one-per-day,
   CSRF, no free text and no profile creation.
3. Full closure gate including WebKit; ignore the known Windows Firefox teardown
   flake unless a real assertion fails.
4. Mark **Iteration 3 CLOSED**, then start Iteration 4 (accounts). Not Iteration 5.

Deferred, tracked, not Iteration 3: the BullMQ worker tier (so the reconciliation and
prune schedules), the least-privilege database principals of SDD §4.9, the error
tracker choice, and the `/privacy` and `/kvkk` routes themselves (FR-CONSENT-05).

---

## 5. Getting the local site running (it will be down)

Docker Desktop stops when the machine sleeps, which takes MySQL and Redis with it and
makes every word page return 500 or the health check 503.

```bash
# 1. Docker Desktop must be running, then:
docker compose up -d mysql redis
# 2. The dev server (watch mode; it reloads code, and views are read per render)
npm run dev
# 3. Confirm
curl -s localhost:3000/health          # {"status":"ok",...}
curl -so /dev/null -w "%{http_code}\n" localhost:3000/en-us/beauty
```

Environment traps that cost time before:

- **`NODE_ENV=production` is set in the shell** on this machine. It makes the test
  suites fail at config load. Run tests with `NODE_ENV=test`.
- **Unit tests may crash a Jest worker** on this machine (memory). `npm run test:unit -- --runInBand` is reliable.
- **Playwright reuses an already-running server on port 3000**, including a stale one
  serving old code — which produced a confusing run of failures. Prefer an isolated
  port: start `PORT=3100 APP_BASE_URL=http://127.0.0.1:3100 node src/server.js`, then
  `E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test --workers=2`. Full-parallel
  browser runs have exhausted memory; `--workers=2` is safe.
- **`tools/` is not committed.** Validation tooling (CMUdict, Gorman `syllabify`) is
  reinstalled per the 2026-09-16 handoff §5; Piper lives in `tools/piper/.venv`.
- `CSRF_SECRET` is unset locally, so a random per-process key is used and tokens stop
  verifying after a restart. That is fine locally; production requires a real one
  (≥ 32 characters).

---

## 6. Commands worth knowing

```bash
# content pipeline, in this order (seed rewrites what the syllable step writes)
npm run seed && npm run seed:phonemes && npm run seed:syllables
npm run audio:generate:words      # relinks existing clips; generates only what is missing
npm run inventory:check           # fails if the phoneme artifact drifts from D4

# save/tag health
npm run reconcile:state           # dry run: report derived-state drift, change nothing
npm run reconcile:state:apply     # repair (the scheduled job's entry point)

# IPA quality (closed — for reference only)
node scripts/validate-syllabification.js
node scripts/report-source-defects.js     # expect 0

# gate
NODE_ENV=test npm run lint && npm run lint:licence
NODE_ENV=test npm run test:unit -- --runInBand && NODE_ENV=test npm run test:integration
npm run size
```

---

## 7. Where the authority lives

`DOC_INDEX.md` routes everything. Current baselines: **SRS v1.0.6**, **SDD v1.1**
(amended §4.2, §4.4, §4.5, §3.4, §6.6), **D4** (§5.2 and §5.8 added), **Frontend
Design Baseline v1** (amended §4.1, §7.4, §8.1, §8.3, §9, §10, §11, §14).
`docs/current/PronounceAll_Iteration3_Product_Decisions_and_IPA_Quality_Plan.md` is
the product direction and the scope split — planning input, not authority.

Schema is at migration **V8**. The save/tag tables are `anonymous_profiles`,
`identity_bindings` (+ `current_identity_bindings` view), `user_activity_events`
(append-only), `user_word_states`, `user_phoneme_states`, and an empty `users` table
that exists so its foreign keys were declared once.
