# PronounceAll — Project Charter

**Version:** 1.0
**Status:** Approved (derived from Feature Brief v0.1, Locked)
**Owner:** Alp K. (solo developer)
**Domain:** pronounceall.com

---

## 0. Creator's note:

This project is built primarily with AI assistance (Claude). The sole maintainer's role is to oversee every file produced, verify correctness, and take final responsibility for all shipped code and content.

## 1. Vision

To be the web's most accessible, honest, and privacy-respecting place to learn English pronunciation. Free forever, open-source, and built to teach sounds as a reusable mental model rather than to sell attention.

## 2. Problem Statement
As a native Turkish speaker, I've always wondered why other languages don't have one sound per letter; as this would make the pronunciation way easier.
Then I found there was already a solution for it, International Phonetic Alphabet. It gives every sound a human uses for speaking a letter/phonetic. PronounceAll aims to make IPA accessible as a learning tool, not just a reference.

Yet IPA is not hard to find, it is hard to learn from. It already sits in the back of every major dictionary, but the tools built around it get in the way more than they help. Dictionary sites bury IPA beneath cluttered layouts, ads, and trackers. Language-learning apps gate pronunciation behind paywalls and mandatory accounts. Most resources optimize for the one-off lookup rather than for teaching the 44 sounds of English as a transferable skill. A learner who wants to understand *why* a word is pronounced a certain way, rather than memorize isolated recordings, currently has no dedicated, free, transparent tool that treats them as a learner first and a user second.

PronounceAll exists to fill that gap as open-source, free software with no profit motive. Because the project is not driven by revenue targets, ad-network contracts, or engagement metrics, every design decision can be optimized for a single goal: helping the learner acquire correct pronunciation. The full source code is published under AGPL-3.0 and the content under CC BY-SA 4.0, so anyone can read the code, audit the data handling, self-host an instance, or fork the project to improve it. Freedom from commercial pressure and freedom of the software itself are treated as two sides of the same commitment, the learner's interest is the only interest being served, and the code is open so that this claim can be verified rather than trusted.

## 3. Target Users

- **Primary:** Non-native English learners of any first language who want to understand pronunciation systematically via IPA rather than rote imitation. Initial emphasis on the global audience, with Turkish learners as a natural secondary base given the developer's context and the KVKK-compliant legal design.
- **Secondary:** Teachers, tutors, and self-learners who need a quick, ad-free, per-word IPA reference for American English.
- **Tertiary:** Open-source contributors interested in pedagogy, phonetics, accessibility, or privacy-respecting web applications.

## 4. Success Criteria (v1.0)

The v1.0 release is considered successful when all of the following hold:

1. Any seeded American-English word is reachable at `pronounceall.com/en-us/:word` and displays its meaning, IPA transcription with clickable per-phoneme audio, whole-word audio, and a syllable/stress breakdown.
2. An anonymous visitor with cookies enabled can browse word pages, save and tag words and phonemes, and complete a self-assessment SM-2 practice session, all without creating an account.
3. A user can register via email-and-password or Google OAuth, choose a unique username, and have their anonymous progress merged into the permanent account.
4. All public pages achieve Lighthouse ≥ 90 in all four categories (Performance, Accessibility, Best Practices, SEO), pass automated WCAG 2.2 AA checks via axe-core with zero violations, and pass an OWASP ZAP baseline scan with no High-severity findings and all Medium findings either remediated or documented with a mitigation or explicit risk acceptance.
5. The GitHub repository is public from day one with AGPL-3.0 code, CC BY-SA 4.0 content, passing CI (lint + test + `npm audit`), and the full documentation set from SRS through Runbook.
6. No non-essential cookies are set by default; every cookie and every field of personal data is justified in the Cookie Table and Privacy Policy.

## 5. In Scope (v1.0)

- American English (`en-us`) word pages showing meaning and pronunciation taught three ways: clickable IPA phonemes with per-phoneme audio and example-word popovers, whole-word audio, and a written syllable/stress breakdown.
- 404 / unknown-word page with fuzzy-match suggestions and a word-request mechanism.
- Progress-aware IPA banner on every word page linking to `/:variant/learnIPA`, showing a live count of phonemes the viewer has tagged `learned` against the total phonemes in the active variant, sourced from `user_phoneme_states`.
- Per-language `/:variant/learnIPA` page covering the variant's phonemes (~44 for `en-us`), frequency-ordered, with the same save/tag system as words.
- Global `/learnIPA` page listing every phoneme across every variant in the `phonemes` table, frequency-ordered, with the same save/tag system; reachable from the site footer. In v1.0 it renders identical content to `/en-us/learnIPA` because `en-us` is the only seeded variant.
- Three-state save system (saved / learning / learned) for both words and phonemes, backed by an append-only event log and derived-state tables.
- Anonymous UUID-cookie profiles and registered accounts (email + password with bcrypt + email verification + password reset, or Google OAuth), with required unique username collection on first registration and deterministic merge-on-login rules.
- Saved-words practice session using SM-2 spaced repetition with self-assessment; wrong answers reinserted 3–7 rounds later.
- Settings page: account management, full Right-to-Erasure deletion, cookie preferences (essentials grayed out), ad opt-in toggle, language variant selector, logout.
- Open-source banner with 30-minute `localStorage` dismissal.
- KVKK- and GDPR-compliant privacy policy (EN + TR), cookie table, and acknowledgement-only notice for the strictly-necessary cookie (no consent requested because none is legally required).
- Docker + Docker Compose deployment (Node/Express, MySQL, Nginx) to Hetzner VPS behind Cloudflare, Certbot for TLS, dotenv for secrets, GitHub Actions CI (lint + test + `npm audit`).
- Hardening pass before launch: OWASP ZAP scan, Lighthouse ≥ 90 across categories, WCAG 2.2 AA accessibility audit, load testing, SEO (sitemap + meta tags), error tracking, automated backups, verified controls for every Threat Model entry.
- AGPL-3.0 license file, README, CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY policy, GitHub issue and PR templates — all in place from day one of the public repo.

## 6. Out of Scope (v1.0)

- Any language variant other than `en-us` (British English, French, Turkish, Spanish, etc. — deferred).
- Microphone-based or ML-based pronunciation evaluation.
- IPA-subset practice (asking users to pronounce words composed of specific phonemes).
- Native mobile applications (iOS / Android).
- Community-contributed audio submissions.
- Dark mode.
- User-facing analytics dashboards ("your weakest phonemes are…").
- Active advertising integration. The opt-in toggle ships in Settings, but no ad network is wired up until a privacy-compatible partner is identified.

## 7. Licensing Statement

- **Code:** GNU Affero General Public License v3.0 (AGPL-3.0). Anyone may read, modify, and reuse the source; any modified version operated as a network service must publish its modifications.
- **Content** (IPA example-word lists, documentation, original recordings): Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
- **Dictionary data:** Sourced from open dictionaries, primarily Wiktionary, with upstream attribution and licensing terms preserved.

## 8. Funding and Sustainability

PronounceAll has no profit motive. Operating costs (domain, VPS, database, transactional email, and occasional TTS regeneration when the dictionary is expanded) are intended to be covered by either (a) opt-in advertising through a privacy-respecting network, if one accepts the opt-in-only model, or (b) voluntary donations via Ko-fi, GitHub Sponsors, or Liberapay. Any revenue above operational costs will be reinvested in the project or donated to open-knowledge initiatives. 

A yearly financial transparency report; listing all revenue sources, operating costs, and any donations forwarded to third parties will be published in the public repository for any year in which the project receives revenue.

## 9. Governance and Ownership

Alp K. is the sole maintainer for v1.0. Responsible for design, implementation, operations, security response, and documentation. External contributions are welcomed under the terms of `CONTRIBUTING.md` and the Contributor Covenant 2.1 Code of Conduct. Security vulnerabilities should be reported privately following the process in `SECURITY.md`, not via public GitHub issues. All design and operational decisions are recorded in the documents enumerated in the Project Handoff Document.

## 10. Change Control

This Charter reflects the v0.1 Feature Brief (Locked) captured in Project Handoff Document v1.0. Any change to vision, success criteria, scope, or licensing requires a simultaneous update to this Charter and to the Handoff Document. Downstream documents (SRS, SDD, ERD, API Spec, Threat Model, etc.) must be revised if the change affects their contents.
