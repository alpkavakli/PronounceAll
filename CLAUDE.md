# CLAUDE.md

Guidance for Claude Code when working in the PronounceAll repository.

PronounceAll is now in the implementation phase. The architecture and product
requirements have already been designed and reviewed.

The default task is to implement the existing specification faithfully, not to
redesign the system.

---

## 1. Documentation retrieval policy

PronounceAll has large specification documents. Conserve context aggressively.

Always start with `DOC_INDEX.md` at the repository root.

Never read an entire SRS, SDD, Handoff, Decisions document, or other large
specification unless the task explicitly requires a whole-document audit.

For documentation-dependent work:

1. Identify the feature or domain involved.
2. Use `DOC_INDEX.md` to identify the governing documents and IDs.
3. Search for the relevant:
   - requirement IDs (`FR-*`, `NFR-*`);
   - decision IDs (`B*`, `C*`, `E*`, `V*`, `D-R3-*`);
   - FIND IDs;
   - section headings;
   - table names;
   - route names;
   - schema fields;
   - terminology.
4. Read only the relevant sections and limited surrounding context.
5. Follow cross-references only when they materially affect the task.
6. Prefer several targeted searches and reads over one full-file read.
7. Before substantial implementation, state the requirements and decisions
   governing the change.
8. If two current authoritative sources conflict, stop and report the conflict.
   Do not choose one silently.

Source precedence and document roles are defined by `DOC_INDEX.md`.

Do not infer authority from a filename alone.

---

## 2. Repository documentation roles

The repository is organized as follows:

- `DOC_INDEX.md`
  - documentation router;
  - always consult first.

- `docs/current/`
  - current specification and decision documents;
  - use only according to the authority and routing rules in `DOC_INDEX.md`.

- `docs/process/`
  - handoffs, process documents, findings, and project workflow material;
  - these do not override the SRS or approved design unless `DOC_INDEX.md`
    explicitly says otherwise.

- `docs/archive/`
  - superseded drafts and historical documents;
  - NEVER use these as implementation authority;
  - read them only when explicitly investigating project history.

- `docs/references/`
  - external reference material;
  - useful as supporting evidence but not authoritative over PronounceAll's
    approved requirements and design.

- `notes/`
  - personal notes;
  - not specification authority.

---

## 3. Specification authority

Use the authority model defined in `DOC_INDEX.md`.

In general:

- SRS = WHAT the system must do.
- Approved SDD / design decisions = HOW the system must implement it.
- Amendment / reconciliation records explain intentional differences between
  requirements and design.
- Archived drafts have no authority.

Do not silently modify a requirement because another implementation seems
cleaner.

Do not silently modify the architecture because another pattern is more common.

If implementation reveals a genuine contradiction between authoritative
documents:

1. stop the affected implementation;
2. identify the exact conflicting sections or IDs;
3. explain the conflict briefly;
4. wait for a decision.

Do not resolve specification conflicts by guessing.

---

## 4. Implementation mode

PronounceAll's architecture is frozen unless the user explicitly requests a
design change.

When implementing:

- implement the smallest complete change that satisfies the governing
  requirements;
- follow the existing SDD rather than inventing a parallel design;
- avoid speculative abstractions;
- avoid infrastructure that is not required yet;
- avoid premature generalization;
- reuse existing mechanisms before creating new ones;
- do not expand the scope of the requested iteration.

Do not reopen resolved FIND items or previously approved design decisions merely
because you would have chosen differently.

If something is underspecified but can be implemented safely without changing
product behavior or architecture, choose the simplest conventional
implementation consistent with the SDD.

If the missing choice changes:
- what the user receives;
- what data is stored;
- retention or privacy behavior;
- a security guarantee;
- a public API contract;
- the schema;
- infrastructure topology;
- or an architectural boundary;

stop and ask instead of inventing it.

---

## 5. Core architectural invariants

These are implementation guardrails. Do not violate them unless an explicit
approved specification change says otherwise.

### Dependency direction

Normal application dependency direction is:

`routes -> services -> repositories`

- Routes are thin.
- Services contain domain/business logic.
- Repositories own SQL.
- Infrastructure invokes domain logic; domain logic must not depend directly on
  concrete infrastructure clients.

Transaction boundaries belong to the domain/service operation that knows what
must be atomic.

### Database

- MySQL 8 is the system of record.
- SQL is raw, parameterized SQL.
- No ORM.
- All normal application SQL lives in repositories.
- Flyway owns schema migrations.
- Never edit an already-applied migration; create a new migration.

### History

`user_activity_events` and `identity_bindings` are append-only history-of-record
structures under the normal application role.

Normal application code must never rewrite event history to implement merge,
undo, reconciliation, or identity changes.

### Sessions

Registered sessions live in Redis.

MySQL `users.session_epoch` is authoritative for session validity.

Do NOT create a MySQL sessions table.

### Explicit v1 schema exclusions

Do NOT add:

- `phonemes.is_active`
- `word_pronunciations.source_ipa`

unless a later approved specification explicitly changes this.

### Pronunciation model

Do not modify the approved canonical en-US pedagogical IPA inventory or its
transcription convention without an explicit specification change.

Browser JavaScript must not perform linguistic IPA parsing that belongs to the
seed/server-side pronunciation pipeline.

### Practice

Committed MySQL practice progress is authoritative over the Redis live queue.

If live Redis practice state is lost, do not invent exact reconstruction of
randomized queue decisions that were never persisted.

### Security

- Use parameterized SQL.
- Never use `Math.random()` for security-relevant values.
- Never commit real secrets.
- Never place secrets in `.env.example`.
- Do not log passwords, tokens, credentials, or other prohibited sensitive
  values.
- Follow the project's CSPRNG and token-entropy requirements.
- Preserve CSRF, rate-limit, authentication, and authorization boundaries from
  the specification.

---

## 6. Before editing code

Before a substantial implementation task:

1. Run `git status`.
2. Inspect the existing implementation relevant to the task.
3. Do not overwrite unrelated user changes.
4. Consult `DOC_INDEX.md`.
5. Retrieve only the governing requirements and design sections.
6. State briefly:
   - what is being implemented;
   - governing requirement/decision IDs;
   - files/components expected to change;
   - important invariants that must be preserved.

Do not produce a large design essay before coding.

A short implementation plan is enough.

Then implement.

---

## 7. Change discipline

Keep diffs narrow.

Do not:

- refactor unrelated code;
- rename unrelated files;
- reformat entire files without need;
- reorganize directories during a feature task;
- replace working infrastructure just because another library is preferred;
- add dependencies for trivial functionality;
- add tables, columns, queues, services, endpoints, or external providers not
  required by the current specification/task.

When adding a dependency:

1. confirm existing dependencies do not already solve the problem;
2. explain briefly why it is needed;
3. use a maintained, appropriate package;
4. consider its license compatibility with the project.

---

## 8. Testing and verification

Never claim a change works without running the relevant checks when the local
environment permits them.

Prefer this order:

1. targeted tests for the changed behavior;
2. relevant integration tests;
3. lint;
4. broader test suite when appropriate.

For database or concurrency-sensitive behavior, test the invariant, not merely
the happy path.

Examples include:

- transaction atomicity;
- uniqueness constraints;
- idempotency/replay behavior;
- duplicate/concurrent requests;
- append-only event behavior;
- authorization failure;
- Redis failure behavior;
- deletion-state claims;
- input validation.

If a test cannot run because of the local environment, report:

- the exact command attempted;
- the exact blocker;
- what remains unverified.

Do not silently skip checks and report success.

---

## 9. Git safety

Treat the user's working tree as valuable.

Before editing:

`git status`

After editing:

`git status`
`git diff`

Do not, unless explicitly asked:

- commit;
- push;
- force push;
- reset;
- rebase;
- amend;
- delete branches;
- discard unrelated working-tree changes;
- rewrite Git history.

Do not use destructive Git commands to make an unexpected state disappear.

If unrelated local changes are present, preserve them.

---

## 10. Specification files during implementation

Do not modify the SRS, SDD, Decisions documents, Charter, or other authoritative
specification documents during an implementation task unless the user
explicitly asks for a documentation/specification change.

Discovering that implementation is inconvenient is not sufficient reason to
change the specification.

If the code cannot faithfully implement an authoritative requirement, report
the problem.

`DOC_INDEX.md` may be updated when document locations or authority actually
change, but do not change its precedence rules casually.

---

## 11. Completion report

At the end of an implementation task:

1. summarize what was implemented;
2. list the important files changed;
3. state the governing requirement/decision IDs followed;
4. report tests/checks run and their results;
5. identify anything intentionally deferred;
6. identify any unresolved issue or specification conflict;
7. stop.

Do not automatically begin the next major iteration.

Wait for approval before expanding into another feature area.