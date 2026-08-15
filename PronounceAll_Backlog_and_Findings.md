# PronounceAll — Backlog and Findings Register

**Purpose:** A single durable home for two kinds of item that surface during documentation work but must not be acted on immediately: future feature ideas, and defects found while reading existing documents. Recording them here prevents loss between chats and prevents mid-pass scope creep.

**Owner:** Alp K.
**Status:** Living document. Append freely; do not delete resolved items, mark them instead.

---

## How to use this document

Two sections, two different meanings.

**Section 1, Post-v1.0 ideas.** Features and improvements deliberately kept out of v1.0. Nothing here is committed. Items graduate into the Charter and the SRS only through an explicit scope decision, never by drifting in during a reading pass.

**Section 2, Findings from reading passes.** Defects, contradictions, and wording problems found in documents that are already drafted. These are real problems awaiting a fix, not optional ideas. Each is fixed either in the Round 4 merge or in a dedicated correction pass.

**When adding an item,** record the date, a one-line summary, and enough reasoning that the item makes sense months later. Where an item touches specific documents, name them, since that determines the size of the eventual change.

**Status values:** Open, Deferred, Scheduled, Applied, Rejected.

---

## Section 1 — Post-v1.0 ideas

### IDEA-01 — Search for words by IPA symbols

**Recorded:** 15 August 2026
**Status:** Open, post-v1.0 candidate

**The idea.** Allow a user to search for words using IPA symbols rather than ordinary spelling. Two possible forms: search restricted to one language variant, and search across every seeded variant at once.

**Why it is attractive.** It inverts the core product flow. Today a learner arrives with a word and discovers its sounds. This would let a learner arrive with a sound, or a sequence of sounds, and discover which words contain it. That suits the stated goal of teaching IPA as a transferable mental model rather than as a per-word lookup.

**Why it is not in v1.0.** Two blockers, of different weight.

First, it requires a word search algorithm operating over phoneme subsets. That same machinery is the stated reason IPA-subset practice was already deferred, recorded at R2 line 607 and in Charter §6. Building it for search but not for practice would be inconsistent, so the two should probably be scoped together.

Second, the cross-language form presumes several seeded variants. Version 1.0 ships American English only, so an all-variants search cannot meaningfully exist until a second variant is added, regardless of what is decided about the single-variant form.

**If it were promoted into scope,** the change would touch Charter §5, Charter §6, and §4.2 of the Round 2 SRS together, and would need its own functional requirements. That is a formal scope change, not a small edit.

---

## Section 2 — Findings from reading passes

### FIND-01 — FR-IPA-08 acceptance criterion is impossible for some phonemes

**Recorded:** 15 August 2026
**Source:** Reading pass on Round 2 SRS, §4.2
**Status:** Open
**Affects:** `PronounceAll_SRS_R2_.md`, FR-IPA-08 acceptance criteria

**The problem.** The second acceptance criterion states that a linter or seed validation test rejects phoneme rows where the first phoneme of the displayed example word differs from the target phoneme. That rule requires every example word to begin with the sound it illustrates.

Several English phonemes cannot satisfy this. The sound written `/ŋ/` never begins an English word, so `sing`, which is the conventional example, would be rejected. The sound written `/ʒ/` has the same difficulty, since the usual examples are `measure` and `vision`. Applied literally, the check would reject correct seed data and leave those phonemes without a valid example word.

**Why it matters.** The body of the requirement is sound. The intent, meaning that an example must demonstrate the target sound rather than a matching letter, is correct and worth keeping. Only the test as written is wrong, because it substitutes word initial position for the broader property actually wanted, which is that the example word genuinely contains the target phoneme.

**Direction for the fix, not yet drafted.** The check should assert that the target phoneme appears somewhere in the phonemic transcription of the example word, rather than at its start. A stricter variant could prefer word initial position where the phoneme permits it, while allowing any position otherwise.

**Suggested handling.** Fold into the Round 4 merge, or into a correction pass before it. Not urgent, since no code depends on it yet, but it must be fixed before the seed validation test is implemented in Iteration 2.

---

*End of register.*
