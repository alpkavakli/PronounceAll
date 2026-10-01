# PronounceAll — WCAG 2.2 AA manual review

**Requirement:** NFR-A11Y-01 (WCAG 2.2 Level AA), Charter SC4.
**Status:** prepared 2026-10-01 (Iteration 7 slice 5); **to be completed, dated and signed by the maintainer before launch.**
**Not specification authority.** It records evidence against the SRS.

The automated half of NFR-A11Y-01 is `tests/e2e/a11y-wcag22.spec.js`. It runs axe-core 4.13 with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` tags. It covers every page in the NFR-PERF-01 list, plus the signed-in account, settings and practice pages and the open phoneme popover. **Result at preparation: zero violations.**

This document is the other half: the Level AA criteria that axe-core cannot decide. Each row lists the evidence that already exists and leaves the judgement to the reviewer.

How to review: go through each row with a keyboard, with a screen reader (NVDA on Windows or VoiceOver on macOS/iOS), and at 320 px wide. Mark **Pass**, **Fail** (with a note) or **N/A** (with the reason).

## 1. Criteria new in WCAG 2.2 (named by NFR-A11Y-01)

| Criterion | What to check | Evidence already in place | Result |
|---|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum), AA | Tab through each page at 320 × 568 with the cookie notice and the open-source banner both showing, then with both dismissed. No focused control may be fully hidden. | Both banners sit in the page flow, not fixed over content. `consent.spec.js` tabs through `/en-us/cupcake`, `/settings` and `/privacy` at 320 × 568 with both banners shown and asserts every focused control is at least partly in view (NFR-A11Y-12). | |
| 2.5.7 Dragging Movements, AA | Is any action done by dragging? | None is. No sliders, sortable lists or drag-and-drop exist; every action is a button, link or form control. **Proposed: N/A, with this justification.** | |
| 2.5.8 Target Size (Minimum), AA | Targets are at least 24 × 24 CSS px, or spaced well enough. | The project's own floor is 44 px (NFR-A11Y-08), asserted at 320 px by `word-page.spec.js` and `phoneme-interaction.spec.js`. axe-core's `target-size` rule passes on every audited page. Inline text links in prose are exempt. | |
| 3.3.8 Accessible Authentication (Minimum), AA | Signing in needs no cognitive function test, or offers an alternative. | Username/email and password fields use standard `autocomplete` (`username`, `current-password`, `new-password`), so password managers fill them. Nothing blocks paste. Google sign-in is an alternative. Turnstile runs as a managed widget, usually with no interaction; when it does challenge, it is a checkbox, not a puzzle. **To check by hand:** sign in with a password manager, and with paste. | |
| 3.3.7 Redundant Entry, A | Information already given is not asked for again in the same process. | Registration asks for each item once (no confirm-password or confirm-email field). Deletion re-authentication asks for the password again on purpose: re-entry for security is an allowed exception. | |
| 3.2.6 Consistent Help, A | Help mechanisms appear in the same place on every page. | The footer, identical on every page, carries the Privacy Policy and the KVKK notice (with the contact address) and the Settings link. | |

## 2. AA criteria NFR-A11Y-01 names for manual review

| Area | What to check | Evidence already in place | Result |
|---|---|---|---|
| Keyboard-only task completion (2.1.1, 2.1.2, 2.4.3, 2.4.7) | With the keyboard alone: look up a word, play it, open a phoneme, save a word and tag it, register, sign in, practise a session, change cookie preferences, delete and restore an account. No traps; the focus order makes sense; focus is always visible. | `phoneme-interaction.spec.js` (opening by keyboard, Space as well as Enter, Escape closing with focus returned), `save-control.spec.js` (Escape and outside click close the menu) and `registration-nudge.spec.js` (a non-modal nudge that takes no focus). Every form works without JavaScript (the `no-javascript` project). | |
| Screen-reader comprehension: the save control | The control announces its state ("Saved", "Learning", "Learned") and opens a menu whose options make sense. A state change is announced. | Accessible names asserted by role in `save-control.spec.js`; axe-core finds no ARIA violations with the popover open. | |
| Screen-reader comprehension: the practice session | A turn reads in order: the word, its audio, then the "right/wrong" choice. The end-of-session summary is announced. | `practice.spec.js` drives a session by role and name, and axe-core is clean on a turn. | |
| Contrast in generated imagery (1.4.3, 1.4.11) | Any image or icon carrying meaning keeps 3:1 against its background, in light and dark mode. | The UI uses text and CSS-drawn controls with Frontend Baseline tokens; axe-core's `color-contrast` passes for text. Non-text contrast (icons, focus rings, control borders) needs the human eye. | |
| Reflow and zoom (1.4.4, 1.4.10) | At 320 px and at 200 % zoom: no horizontal scrolling, nothing cut off. | `word-page.spec.js` and `learn-ipa.spec.js` assert no horizontal scrolling from 320 to 1440 px; legal tables wrap rather than scroll. | |
| Audio (1.4.2) and media alternatives | No audio plays automatically; every sound has its written IPA and example. | Audio plays only on activation (FR-SAVE-09 records only genuine starts); the transcription is always on the page. | |
| Language of parts (3.1.2) | Turkish content is marked as Turkish. | `/kvkk` is served with `lang="tr"`; the footer's KVKK link carries `lang="tr"`. | |

## 3. Sign-off

| | |
|---|---|
| Reviewed by | |
| Date | |
| Assistive technology and browsers used | |
| Outstanding failures, with their tracking items | |
| Signature | |
