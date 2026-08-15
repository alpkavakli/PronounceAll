# PronounceAll — Round 4 Merge and Onward Path Handoff

**Purpose:** Instructions for the chat that merges the Round 2 and Round 3 SRS files into SRS v1.0, followed by the plan for what happens after the merge, meaning the SDD, the schema decision, and the start of building. Written 15 August 2026.

**Owner:** Alp K., solo developer.

**Read this first if you are the merge chat:** your job is section 2 only. Sections 3 onward exist so the maintainer knows what follows, and so you do not drift into that territory.

---

## 1. Where the project stands

All Phase 0 documentation through Round 4 Decisions is drafted. A prior implementation pass applied the Option B URL split, meaning the global page lives at `/learnIPA` and per-language pages live at `/:variant/learnIPA`. A verification chat confirmed all twenty one of those edits landed correctly across six files, with no outstanding corrections.

A partial reading pass over Round 2 section 4.3 surfaced several findings. Two are resolved by the merge itself. Three are recorded in the Backlog and Findings Register and are not merge work. One is a genuine conflict between two drafted requirements and must be settled during the SDD, before any code touches the event log. That conflict is described in section 4 below.

The reading pass has been deliberately stopped. Its yield did not justify its cost, and the SDD will force close reading of the consequential requirements anyway.

---

## 2. What the merge chat must do

### 2.1 Files to upload

Project Charter, Handoff Document, Foundational Decisions, SRS Round 2, SRS Round 3, Round 4 Decisions, Round 4 Handoff, and the Backlog and Findings Register.

### 2.2 The mechanical task

Follow section 2 of the Round 4 Handoff. In summary:

1. Merge Round 3 into Round 2 so the result runs from section 1 through section 7 in order. Round 3 plugs in immediately after section 4.9 and before the Round 2 footer.
2. Apply all sixteen Round 4 decisions at their annotated locations.
3. Sweep every cross reference. Each functional requirement citation in sections 5 and 6 must resolve to a requirement that still exists in section 4, and each non-functional citation in section 6 must resolve to one in section 5. Charter success criterion references must match Charter section 4 numbering.
4. Remove the Round 3 drafting notes section and the Round 3 merge instructions section. Both have served their purpose.
5. Produce a complete table of contents covering sections 1 through 7.
6. Set the version header to 1.0 with status Approved, pending maintainer sign off, and add the changelog entry recording the merge of Rounds 2 and 3 with Round 4 decisions applied.

Output is a single Markdown file. Do not rewrite content, do not add requirements, do not revisit Foundational Decisions.

### 2.3 Two extra items beyond the standard plan

These are not in the Round 4 Handoff and would otherwise be missed.

**Item A, a clarification in FR-SAVE-02.** The popover offers None as a choice that returns an item to untagged saved, but the document never says how that is recorded. Amend the final clause so that selecting None resets the state to saved untagged, recorded as a tag change event carrying a null value.

**Item B, a consequence of Decision 6.** Decision 6 elevates FR-SAVE-09 to Must and splits the audio event type into a word variant and a phoneme variant. Applying that decision has a downstream effect the annotations do not flag: FR-SAVE-04 excludes audio events from derived state by naming the single old event type, and FR-SAVE-03 lists that same old type in its event type enumeration. Both must be updated to name the two new types, otherwise the merged document contains an event type that no longer exists. Sweep for every occurrence of the old type name and update each one.

### 2.4 What the merge chat must not do

Do not resolve the conflict described in section 4 of this handoff. It requires a maintainer decision with schema consequences and is out of scope for a mechanical merge. Leave both requirements as drafted. Do not begin design work. Do not act on items in the Backlog and Findings Register beyond items A and B above.

### 2.5 Suggested opening instruction

> Uploaded: Charter, Handoff Document, Foundational Decisions, SRS Round 2, SRS Round 3, Round 4 Decisions, Round 4 Handoff, Backlog and Findings Register, and the Merge and Onward Path Handoff. Produce SRS v1.0 per section 2 of the Merge Handoff, including the two extra items in section 2.3. Do not resolve the event log conflict in section 4. Do not rewrite content or add requirements.

---

## 3. After the merge, the SDD

The SDD is the next document. It is substantial, roughly thirty to forty pages per the original plan, and it is where the database schema, the module structure, the audio pipeline, and the session and merge mechanics are actually designed.

### 3.1 Open the SDD chat with the conflict named

Do not let the SDD chat discover the event log conflict on its own, because it may not. If it designs the table without knowing a conflict exists, it will silently choose one side and the choice will arrive disguised as a finished schema. Name it in the opening instruction and require the tradeoff to be presented before any table is drawn.

### 3.2 Ask for reasoning before artifacts

When the schema is discussed, ask for the options and their consequences first, and the design second. Evaluating two stated options is far easier than arguing with a completed diagram. For the event log specifically, the question that exposes the whole design is this: what happens to rows that already exist when an anonymous visitor logs in, and what does the actor column look like under each option.

### 3.3 Bring the register

The Backlog and Findings Register holds items the merge does not touch, including the cookie detection gap in FR-SAVE-06 and the rate limit bucket question for audio events. Several are design level questions that the SDD is the natural place to answer rather than merely record.

---

## 4. The conflict that must be settled before Iteration 3

This is the most consequential finding from the reading pass. It is a conflict between two requirements that are both already drafted and both marked Must.

**FR-SAVE-03** establishes the event log as append only. Rows are never updated or deleted by application code except during account hard deletion. It goes further and fixes this at the database privilege level, granting the application database user only insert and select rights, with update and delete reserved for the deletion worker.

**FR-AUTH-18** specifies that when an anonymous visitor logs in, the system merges their history by re-pointing the anonymous identifier column on existing event rows to the user identifier of the account.

Re-pointing a column on existing rows is an update. Under the privilege model in FR-SAVE-03, the merge described in FR-AUTH-18 cannot execute. One of the two requirements has to yield.

**The two directions, stated neutrally.**

The first is to relax the append only rule for this one controlled operation, permitting the merge worker to update the actor column and nothing else. This keeps the schema simple, since each row continues to carry its actor directly, but it weakens the guarantee that the log is immutable and introduces a second privileged path alongside the deletion worker.

The second is to leave event rows permanently immutable and record the relationship between an anonymous identifier and an account in a separate link table, with derived state recomputed across both identities. This preserves immutability strictly and keeps a full record of which events originated anonymously, at the cost of an extra join and slightly more complex derivation.

**Why the timing matters.** This is a schema decision, not a wording decision. Once the event log holds real user history, changing the actor model means a migration against live data. The decision must therefore be made during the SDD, and certainly before Iteration 3 builds the save system.

---

## 5. Build order and what is safe to start

The iteration plan is unchanged: foundation, word pages, IPA system, save and tag, auth, practice, settings, hardening. Each is finished before the next begins.

**Safe to build immediately after the SDD covers them.** Iteration 0, meaning foundation, and Iteration 1, meaning word pages. Neither touches the event log, the save system, or merge logic, so nothing recorded in the register or in section 4 blocks them. Iteration 2, the IPA system, is likewise unaffected, though it does depend on the phoneme seed data and therefore on the example word rule discussed below.

**Blocked until the section 4 conflict is settled.** Iteration 3, the save and tag system, and by extension Iteration 4, auth, since merge on login depends on the same actor model.

**Two register items that become relevant at specific points.** The example word validation rule recorded as FIND-01 must be fixed before the seed validation test is implemented in Iteration 2, because the rule as written would reject correct data for phonemes that cannot begin an English word. The rate limit bucket question for audio events becomes relevant in Iteration 2 as well, since a learner exploring the phoneme page could exhaust a budget shared with saves.

---

## 6. Standing reminders

The Threat Model can wait until the hardening pass, given that nothing is published before Iteration 1 completes. It replaces the pending annotations that remain throughout the traceability matrix.

The external reference checks covering GDPR, KVKK, and the SM-2 algorithm are still outstanding from the original Reference Sweep Audit. They suit a single dedicated chat and are not urgent, but they should happen before launch, since the privacy policy and the practice algorithm both make specific claims that have not been verified against primary sources.

New ideas and newly found defects go into the Backlog and Findings Register rather than into whichever chat happens to be open. Mention the register at the start of each new chat so the habit holds.

---

*End of handoff. The next chat produces SRS v1.0. The chat after that begins the SDD.*
