# PronounceAll: SDD Round 1 Decisions Document

**Version:** 1.0.3
**Status:** Approved. Round 1 baseline; §6 ledger extended by a follow-up addendum, architecture unchanged.
**Owner:** Alp K. (solo developer)
**Changelog:**
- 1.0.3: ledger addendum only, from the full-SRS reconciliation against v1.0.2. §6 gains items 10 to 14, item 9's reference is corrected to `FR-WORD-03`, refinements are noted on items 3 and 4, and two open items are added in §7. No architecture section changed.
- 1.0.2: V3 login race restated as an acceptance gated guarantee (a session validated against stale state is never accepted, enforced by the per request epoch check) rather than a cross store atomic write, and the lock across Redis approach is explicitly rejected; B1 adopts an at most one authenticated user per anonymous identity invariant, grounded in FR-AUTH-18, replacing the earlier latest wins across users wording; the editorial note under V1 about verbatim preservation removed.
- 1.0.1: review correction pass (V3 wording, C4 `lib` import rule, V4 storage boundary, C6 hard delete specifics, C2 single `AppError`, V1 legal rationale and verbatim residual, B2 "only option", B1 conflict flag).
**Purpose:** Output of SDD Round 1. Records every decision from the Round 1 inventory in the SDD Handoff §6, with rationale and an implementation note where useful, plus rejected alternatives and the amendment ledger. This is a required upload for SDD Rounds 2 through 4.

**Relationship to prior documents:** Requirements baseline is SRS v1.0. Foundational Decisions (SRS Round 1) and the Round 4 Decisions remain in force and are not reopened here. Where a decision below changes settled requirement text, it is captured in the Amendment Ledger (§6) rather than applied silently, per D7.

**Reading note:** decisions are grouped as the Handoff §6 grouped them: blocking (§1), cross cutting conventions (§2), content and algorithms (§3), vendor and infrastructure (§4). The three hard flows and the full schema are Round 2 and Round 3 work; this document fixes the decisions those rounds build on.

---

## 1. Blocking decisions

### B1: Event log identity model

**Decision.** Event rows in `user_activity_events` are permanently immutable. When an anonymous visitor authenticates, the association between the anonymous identity and the account is recorded by appending a row to an append only `identity_bindings` table with `event_type = LINK`, not by editing existing event rows. Ownership is resolved through the bindings, exposed as a `current_identity_bindings` SQL view rather than a materialised projection. v1.0 uses `LINK` only; there is no `UNLINK` value, column reservation, or flow. A future unlink, if ever required, arrives as its own deliberate migration with its own semantics and tests, and that migration revises the view.

**Rationale.** This preserves the strongest form of the append only guarantee. Re pointing an actor column on existing rows, as the original `FR-AUTH-18` described, is an `UPDATE` that the append only privilege model forbids, so one requirement had to yield. Recording identity as its own append only history keeps `FR-SAVE-03` intact and folds in the one worthwhile property of deriving identity from the log, namely that identity is history rather than a mutable pointer, without paying the cost of replaying the activity log on every read. A single indexed join through the bindings is far cheaper on the hot word page path than a per read log fold.

**Implementation note.**
- Privilege split, which is where the guarantee actually lives:
  - History of record tables, append only: `user_activity_events` and `identity_bindings`. The application database role holds `INSERT` and `SELECT` only. No `UPDATE`, no `DELETE`.
  - Derived projection tables: `user_word_states`, `user_phoneme_states`. The application role holds `INSERT`, `UPDATE`, and `SELECT`, because synchronous derivation upserts them. They carry no `DELETE` for the application, so an unsave is represented as a state value on the row rather than a row deletion, which keeps the destructive surface with the deletion worker alone.
  - The deletion worker holds the single narrow erasure credential (see §4, V6 and the deletion flow).
- `current_identity_bindings` is a plain indexed SQL view over `identity_bindings`, not a materialised table, because the binding set per user is tiny and a view removes a write and reconciliation path.
- Derived state upserts key on the resolved identity through the bindings, and a `LINK` triggers recomputation across both identities.
- Binding invariant: an anonymous identity is bound to at most one authenticated user, enforced by a uniqueness constraint on `anonymous_id` in `identity_bindings` (at most one `LINK` per anonymous identity). A user may hold many bound anonymous identities, since cross device use under `FR-AUTH-19` links each device's own anonymous UUID to the account, so the constraint is on `anonymous_id`, not on `user_id`. This matches `FR-AUTH-18`, which merges only when the anonymous profile is not already linked and retires the anonymous UUID after merge: continued anonymous browsing after a link mints a new anonymous identity rather than reusing the retired one, which prevents any cross account transfer of immutable anonymous history. The `current_identity_bindings` view therefore resolves no same identity to different users conflict and is a straight lookup.

---

### B2: Caching for personalised word pages

**Decision.** Word pages are served as a cacheable public shell that contains the reader content only, with per viewer save and tag state and the progress banner count delivered by a small client side hydration endpoint that returns JSON.

**Rationale.** The rendered page shows per viewer state, so the full HTML cannot be shared across viewers, yet `NFR-PERF-04` distinguishes a cached from an uncached time to first byte, which presumes caching exists. Splitting the shell from the personalised layer is the preferred option under the current constraints for making the cached budget real; other approaches such as private caching, fragment caching, and edge composition exist but fit this project's per viewer state and no JavaScript reading rule less well. It also aligns with the progressive enhancement rule in Foundational Decisions §5: the reader content is server rendered and readable with no JavaScript, and the personalisation that requires JavaScript is exactly the layer that degrades.

**Implementation note.** The shell is identical for every viewer of a word and takes long lived edge cache headers at Cloudflare. The hydration endpoint reads the derived state tables from B3. `NFR-PERF-05` currently lists user state and the progress banner count inside the single word page composition budget; under this split those move onto the hydration endpoint, so that requirement is re annotated (Amendment Ledger item 4).

---

### B3: Derived state maintenance

**Decision.** Derived state is written synchronously in the same database transaction as the event, with a scheduled reconciliation job as a drift safety net.

**Rationale.** The save button demands read your writes consistency: a user who taps `learned` and reloads must see `learned`. A synchronous upsert gives that and keeps practice queue construction and the B2 hydration endpoint plain indexed reads. `FR-SAVE-04` already mandates that a reconciliation script exists and that a dry run recompute matches the live tables, so scheduling it satisfies the drift clause without new requirements.

**Implementation note.** Qualifying events upsert the derived row; `audio_listen_*` and `practice_attempt` are excluded per `FR-SAVE-04`. Idempotency of the 30 second window (`FR-SAVE-08`) is enforced at the write. The upsert keys on the resolved identity through `identity_bindings` (B1), and a merge recomputes across both identities, which is what the amended `FR-AUTH-18` requires post merge.

---

## 2. Cross cutting conventions

### C1: Logging library, format, and PII redaction

**Decision.** pino, structured JSON lines, with a single shared logger module carrying a central `redact` configuration and a request scoped correlation id.

**Rationale.** Every handler logs, and `NFR-SEC-10` forbids any log from ever holding a password, a session, CSRF, reset, or verification token, an OAuth token, HIBP query content, or a full email address outside a restricted audit trail. A single redaction configuration gives that rule one enforcement point rather than per handler discipline.

**Implementation note.** Handlers log through the shared logger, never `console`, and never log raw request bodies on auth or save routes. The correlation id threads into the error taxonomy (C2). Nginx access logs stay separate for the IP and request line, retained 30 days per `NFR-OPS-04`, with application logs at 90 days reducing to 30 when stable.

---

### C2: Error taxonomy and surfacing

**Decision.** A single centralised `AppError` type carrying a stable machine code, an HTTP status, a safe message, the underlying cause, and a metadata field for kind specific data, terminated by a single Express error middleware that branches on the response surface: an EJS error view for HTML routes, a JSON error object for JSON routes. Error kinds are represented as codes and statuses on that one type, not as a subclass tree, since a class hierarchy earns its place only where behaviour actually differs, which here it does not.

**Rationale.** Two surfaces exist, server rendered EJS pages and JSON endpoints, and every feature produces errors. One taxonomy and one surfacing rule keep them consistent, and features throw typed errors rather than formatting their own responses.

**Implementation note.** The error kinds are validation (400), auth (401 or 403, always the generic invalid credentials message per Foundational Decisions §2, never user not found), not found (404, the styled fuzzy suggestion page for words), conflict (409, username or email collision), rate limit (429), and internal (500), each expressed as a code and status on the one `AppError` type. Only the safe message reaches the user; the cause and stack go to the pino log under the correlation id. Kind specific data travels in the metadata field, for example the `Retry-After` value the middleware sets on a rate limit response per §10.3.

---

### C3: Database migration tooling

**Decision.** Flyway, with versioned plain SQL migration files.

**Rationale.** The project uses raw SQL and no ORM, so migrations should be reviewable SQL, and Flyway checksums applied migrations, which detects an after the fact edit of a shipped migration and aligns with the immutability posture of the event log and bindings. The cost is a standalone CLI added to the image rather than an npm package, which is accepted.

**Implementation note.** Migrations live under `migrations/`. ORM coupled tools are avoided by design. A lighter Node native alternative (postgrator, plain SQL do and undo files) was considered and set aside in favour of the checksum guardrail.

---

### C4: Directory structure and module boundaries

**Decision.** A layer based structure captured canonically in the SDD, with clear feature boundaries inside each layer. No `controllers/` layer unless route handlers grow substantial. The structure is layer oriented for v1.0 and can be reorganised into feature oriented directories later without changing the dependency rules.

**Canonical structure.**

```
src/
  routes/
  services/
  repositories/
  middleware/
  validators/
  errors/
  config/
  lib/
  views/
  public/
  workers/
  jobs/
migrations/
scripts/
tests/
```

**Responsibilities.**
- `routes/`: HTTP routing and thin request and response handling.
- `services/`: domain and business logic, independent of Express where possible.
- `repositories/`: all database access and raw SQL; the only normal application layer that talks directly to `mysql2`.
- `middleware/`: authentication and session handling, CSRF, rate limiting, request logging, error middleware.
- `validators/`: request and input validation schemas and logic.
- `errors/`: `AppError`, stable error codes, and related definitions.
- `config/`: environment and configuration loading.
- `lib/`: shared infrastructure clients and utilities, for example the logger, database pool, Redis and BullMQ connection setup, crypto helpers, id generation.
- `views/`: EJS templates and partials.
- `public/`: browser side JavaScript, CSS, images, audio, and other static assets.
- `workers/`: standalone worker entry points that run separately from the Express application, including the deletion worker with its separate database credentials.
- `jobs/`: reusable BullMQ job definitions and handlers, keeping queue and scheduling concerns separate from the underlying service logic.
- `migrations/`: versioned Flyway SQL migrations.
- `scripts/`: one off operational, import, seed, and reconciliation utilities.
- `tests/`: unit, integration, and end to end tests.

**Dependency rule.** Routes depend on services, services depend on repositories, repositories own SQL. Pure configuration values and stateless utilities may be imported widely, but concrete infrastructure clients in `lib` (the database pool, the Redis and BullMQ connections, and similar) are consumed only by adapters, repositories, and the composition root, never by business services. A service receives what it needs through a function argument or an injected interface, so the principle below holds in practice rather than only on paper.

**Named architectural principle.** Infrastructure invokes domain logic, never the reverse. BullMQ, the logger, the database pool, and the Redis client are boundary concerns. A job handler is a thin adapter that deserialises a payload, calls a service function, and maps the result to success, failure, or retry; the logic lives in `services/` and is reachable without the queue. This makes the `jobs/` and `workers/` split precise, and it gives the one implementation, several entry points rule its shape: a function such as `reconcile()` or `deleteAccount()` lives once in `services/`, and the scheduled job, the manual `scripts/` utility, and the worker entry point are all thin adapters around it.

**Rationale.** This gives the cross cutting conventions a home and gives the privilege separation from B1 a physical place: the deletion worker is a separate entry point under a different credential, not a route. Threading the language variant as a data dimension through repositories and services rather than branching it in routes is what makes `FR-WORD-10` true, that adding a variant is a row insert plus a content batch rather than a code change.

---

### C5: Event timestamp column type

**Decision.** `DATETIME(3)` for the event timestamp, plus a `BIGINT` auto increment `event_id`, with derivations ordered by `(occurred_at DESC, event_id DESC)` and the connection `time_zone` set explicitly to UTC. The same column and ordering apply to `identity_bindings`.

**Rationale.** `DATETIME(3)` gives millisecond precision without the 2038 ceiling and the session time zone conversion behaviour that make `TIMESTAMP` risky, and it stays human readable and native to MySQL date functions, which the dormancy purge and any reporting want. `FR-AUTH-18` already argues a same target same millisecond collision is effectively impossible, so the auto increment id is defence in depth: it yields a total order that resolves any theoretical tie without depending on timestamp granularity, which closes the tie break the Round 4 sketch left open.

**Implementation note.** A `BIGINT` Unix milliseconds column was the considered alternative and is defensible if zero MySQL temporal semantics were wanted, at the cost of readability and native date functions, which is a trade not worth making on a single MySQL deployment.

---

### C6: Background job model and scheduler

**Decision.** BullMQ, running on the self hosted Redis the project already operates, with workers as standalone processes under their own credentials, using the current Job Schedulers API for recurring work, with retries and backoff, and idempotent handlers.

**Rationale.** An in process scheduler inside the Express application is the wrong choice here, because the application may run as several instances behind Nginx, so every instance would fire the job. The deletion worker also needs a `DELETE` credential the application role does not hold, so it cannot live in the application process regardless. BullMQ fits both constraints on infrastructure that already exists, and it keeps dispatch and execution in one system.

**Idempotency rule (governing SDD text).** Idempotency must hold under both sequential retries and concurrent duplicate execution. A predicate check alone is insufficient wherever a check then act race is possible. Each job defines the database constraint, transaction or locking strategy, deterministic resource key, or explicit idempotency key that makes duplicate execution safe. BullMQ level deduplication and stable job ids are additional safeguards, not a substitute for business level idempotency.

**Per job mechanisms.**
- Reconciliation: deterministic recompute and upsert within a transaction, serialised per actor by a row or advisory lock, convergent by construction.
- Hard deletion: an atomic compare and set claim (for example flipping account state from `scheduled` to `in_progress` and proceeding only if one row changed) so a single worker owns the deletion. The tombstone insert and the confirmation delivery must each be idempotent under retry and concurrent duplication; the concrete mechanism is specified in the deletion flow design rather than settled here.
- Dormancy purge: same shape as deletion; the two year eligibility predicate selects candidates, and an atomic per profile claim, not the predicate, makes concurrent duplicates safe.
- TTS generation: a deterministic asset key (variant, target, voice or version), then an atomic claim through a unique constraint on that key, so two workers that both observed the asset missing cannot both generate it.

**Implementation note.** The reconciliation job (B3), the post grace hard delete (deletion flow), and the `NFR-PRIV-02` dormancy purge run as recurring jobs against separate worker processes. The erasure jobs share one narrow `DELETE` credential (see V6). The TTS batch (V1) runs here as one more job. The atomic claims imply small state columns, a deletion state on the account, a claim marker on the anonymous profile, and a status on the audio asset row, which the schema round formalises.

---

## 3. Content and algorithms

### E1: Seed data ingestion pipeline

**Decision.** A staged, variant parameterised, idempotent pipeline of fetch, normalise, validate, and load. Reusable normalise, validate, and load logic lives in `services/`; the one off import entry point lives in `scripts/`. The loader upserts on natural keys so a re run converges. Variant is a data dimension, a `language_variants` row plus a threaded column, not a code branch.

**Rationale.** `FR-WORD-10` requires that adding a variant is a row insert plus a content batch, never a code change, which forces variant parameterisation and re runnability. A staged pipeline with a validate stage that produces a dry run diff keeps content changes reviewable before load, and the upsert on natural keys matches the C6 idempotency rule.

**Implementation note.** Any word or phoneme lacking a Wiktionary human recording enqueues a TTS batch job keyed on the deterministic asset key. The pipeline feeds the audio fallback chain: Wiktionary human recording first, Piper batch second (V1), Web Speech API at runtime last.

---

### E2: Phoneme example word artifact and the FIND-01 fix

**Decision.** The phoneme example word list is a standalone artifact of roughly 44 en-us phonemes with example words, referenced by the SDD (per D4). Every example is verified against a named primary reference with per row source attribution for CC BY-SA. The `FR-IPA-08` validation is corrected: the check asserts that the target phoneme appears somewhere in the phonemic transcription of the example word, preferring word initial position where the phoneme permits it and allowing any position otherwise. v1.0 ships on maintainer review, with phonetician review flagged as a pre launch Should rather than a blocker.

**Rationale.** FIND-01 records that the original `FR-IPA-08` acceptance criterion, requiring the example word to begin with the target phoneme, is impossible for phonemes that never begin an English word, such as the sound in `sing` or `measure`, so it would reject correct seed data. The corrected rule keeps the intent, that the example genuinely demonstrates the sound, without rejecting those phonemes.

**Implementation note.** This resolves FIND-01 at the design level and confirms the design does not depend on the impossible criterion. `FR-IPA-08` is reworded (Amendment Ledger item 6) and FIND-01 moves from Open to Scheduled, to be fixed before the Iteration 2 seed validation test.

---

### E3: 404 fuzzy match algorithm

**Decision.** A two stage match on the 404 path, run in application over the cached headword list for the active variant. Stage one generates candidates cheaply (shared first letter, shared Double Metaphone bucket, or a short edit distance prefilter). Stage two ranks candidates by a blend of Optimal String Alignment distance and a Double Metaphone match and returns the top N.

**Rationale.** The audience is non native learners who misspell both by typing slips and by spelling words as they sound, and the two signals cover different errors. Optimal String Alignment, the restricted form of Damerau-Levenshtein, is sufficient because it directly models the adjacent transposition typo class, such as `freind` to `friend`, and it stays cheap over the small v1.0 candidate set. Plain Levenshtein does not model transposition as a single edit and was rejected for that reason. Double Metaphone covers phonetic approximations, and Soundex is too crude.

**Implementation note.** The 404 path runs only on a cache miss, so it is off the hot path. Suggestions stay variant scoped, consistent with the C4 threading. If a later variant grows the headword list beyond comfortable in memory scanning, candidate generation moves into a precomputed phonetic key index column without changing the ranking.

---

### E4: Word and pronunciation data model

**Decision.**
- `words` carries `UNIQUE (variant_id, normalized_headword)`. Meaning is stored at the word level, sourced from the dictionary, as SRS v1.0 already specifies.
- `word_pronunciations` is many per word, so heteronyms such as `lead` live under one word entry rather than being split by the natural key. It gains `is_primary` and `display_order`, populated and validated at ingestion so exactly one primary exists per word and the ordering for the active variant is deterministic, and an optional per pronunciation gloss for heteronym disambiguation.
- A full `word_senses` model is not introduced in v1.0. It can be recorded as a post v1.0 register idea if a definitions feature is ever scoped.
- `audio_assets` gains provenance and licence columns: source reference, author, licence identifier, licence URL, attribution text, and retrieval date.

**Rationale.** The natural key must not imply one pronunciation per headword. SRS v1.0 already models `word_pronunciations` as at least one per word, so heteronyms are schema supported, but the render requirement reads as a single transcription, so a deterministic primary and order must exist rather than being chosen implicitly at runtime. A pronunciation tool needs only enough meaning to disambiguate heteronyms, so a word level meaning plus an optional gloss is sufficient and a sense hierarchy is an unnecessary layer for v1.0. Audio assets on Wikimedia carry their own per file licences, so provenance and licence must be captured per asset to prove distributability and to attribute correctly.

**Implementation note.** The validate stage includes a licence compatibility gate that flags or rejects audio whose licence is incompatible with the application's intended use and processing, assessed against actual use rather than a licence family in the abstract, and audio attribution is provided in the manner the asset's licence requires, with placement a UX decision. This drives Amendment Ledger items 7, 8, and 9.

---

## 4. Vendor and infrastructure

### V1: Text to speech provider

**Decision.** Selected for v1.0: Piper, run as a separate batch tool, plus the `en_US-libritts-high` voice on a chosen speaker id, output intended for distribution under CC BY-SA 4.0 with attribution to LibriTTS.

> **Selected for v1.0 with documented residual uncertainty regarding the precise copyright/licensing status of generated WAV output. The project intends to distribute generated audio under CC BY-SA 4.0, subject to pre-scale/legal confirmation.**

**Rationale.** Reviewed against primary sources. The engine, OHF-Voice/piper1-gpl, is GPL-3.0, confirmed by the v1.3.0 release note; it is run as a separate batch tool, not linked into the application, so it does not affect the application licence, and a program's licence does not attach to its output. Output rights depend on the voice model and its training data, not the engine, and the maintainer states the project imposes no additional licence on voices and leaves the judgement to the user. The `en_US-libritts-high` model card confirms a CC BY 4.0 dataset (LibriTTS, OpenSLR 60) and training from scratch on train-clean-360, and LibriTTS derives from public domain LibriVox recordings. CC BY 4.0 supplies broad permissions over the licensed source material that are compatible with the intended downstream open content model, and among all candidates reviewed this chain has the cleanest such provenance; the generated WAV's own copyright and licensing status remains the documented residual below, not a settled conclusion. Self hosting also keeps the asset chain publicly regenerable, which is the point of the open content claim.

**Residual and boundary.** The step from the dataset and model licence to the precise copyright status of the generated WAV is an inference the model card does not explicitly make. Under the project's pragmatic risk posture this is an acceptable documented residual for an early stage project: it is an unresolved output licensing edge, not an identified prohibition, the evidence is reasonably favourable, and the implementation keeps the engine and voice replaceable. It is to be revisited before meaningful scale or commercial exposure, with legal confirmation. Full generator, voice, and dataset provenance is preserved so replacing or regenerating assets later is straightforward.

**Recorded note for legal review.** Most Piper voices use the GPL licensed espeak-ng phonemizer in the synthesis path, and the Piper maintainer is unsure whether that affects the output WAV. The mainstream reading is that synthesized audio is not a derivative of the phonemizer, but the point is unresolved and is recorded for the eventual legal review rather than treated as a v1.0 blocker.

**Rejected and ranked alternatives, from primary terms.**
- **AWS Polly, strongest cloud fallback.** AWS explicitly permits storing and redistributing Polly speech output in standard formats for any use case and states no restrictions on storing and reusing generated speech, which is substantially stronger than an in application use grant. The open question is whether that grant is broad enough for the intended CC BY-SA sublicensing and open content treatment over a proprietary voice, and the binding AWS Service Terms rather than the FAQ are the instrument to confirm it against.
- **Google Cloud TTS, weaker fallback.** The documentation clearly permits using generated audio in applications and media, but open relicensing and redistribution rights are not explicit enough for the open content purpose. The generic Generated Output is Customer Data clause in the Service Specific Terms should not be relied upon unless it is confirmed that the provision specifically applies to classic Cloud Text to Speech.
- **Azure Speech, not preferred for the open content role.** Open relicensing rights are insufficiently established and the service introduces additional continuing obligations, including a code of conduct and synthetic voice disclosure requirements. This is recorded as not preferred rather than as conclusively legally incompatible, absent stronger primary source evidence.

**Implementation note.** The Piper batch runs as a job under C6, filling the AI TTS slot in the audio fallback chain. Generated assets record generator, voice, speaker, and version in the `audio_assets` provenance columns (E4), and the audio attribution required by the amended `FR-CONTENT-05` is the LibriTTS CC BY 4.0 credit. This substantiates the Charter's generated audio claim rather than amending it, subject to the residual above.

---

### V2: Redis deployment shape

**Decision.** A self hosted Redis container in the existing Docker Compose stack on the VPS, a single instance, with AOF persistence and `maxmemory-policy noeviction`. Redis memory usage is a monitored signal with alerting.

**Rationale.** One instance carries four workloads: rate limit counters and the idempotency store (ephemeral), and BullMQ jobs and sessions (durable). A managed service is cost and complexity a solo VPS does not need. `noeviction` protects the durable data, with TTLs handling the ephemeral keys, and it means writes return errors once `maxmemory` is reached, so memory must be monitored rather than left to evict silently.

**Implementation note.** Separate logical databases are not meaningful isolation, since they share one process, one memory ceiling, and one persistence file. If workloads ever need real isolation, that is a second instance, not DB 0 versus DB 1.

---

### V3: Session store

**Decision.** Redis backed sessions, with the authoritative `session_epoch` held in the MySQL `users` row.

**Mechanism.**
- The `users` row carries the authoritative `session_epoch`; the `password_hash` lives on the `user_accounts` row (SRS Appendix E, FR-AUTH-08). A password change or security reset performs both writes in the same MySQL transaction: `user_accounts.password_hash = new_hash` and `users.session_epoch = session_epoch + 1`. Password state change and invalidation generation are therefore atomic within one datastore, since a single MySQL transaction spans the two rows.
- Each Redis session stores `user_id`, `session_epoch`, and `absolute_expires_at`. An authenticated session is valid only if its stored epoch still equals the authoritative `users.session_epoch`; on mismatch it fails closed.
- Idle timeout is 30 minutes. Absolute timeout is 12 hours via `absolute_expires_at = created_at + 12h`, enforced independently by middleware regardless of activity. The effective Redis expiry is bounded by the smaller of the remaining idle window and the remaining absolute lifetime, so the key cannot outlive the absolute deadline.
- Login race rule: the guarantee is that a session created from credentials validated against stale account state is never accepted as authenticated. The flow validates credentials against epoch `E`, rechecks that the authoritative `users.session_epoch` is still `E`, then creates the Redis session carrying `E`. Authority rests on the mandatory epoch comparison performed on every authenticated request: any session whose stored epoch does not equal the current `users.session_epoch` fails closed. If a password change increments the epoch in the narrow window between the recheck and the Redis write, a stale session key may briefly exist, but it can never authorise a request, because its epoch no longer matches. This is deliberately not made atomic by holding a MySQL row lock across the Redis write, which would put an open database transaction around network I/O for no security benefit, since the per request check already closes the gap.
- The reverse index `user_sessions:<user_id>` remains for immediate key cleanup and device and session management, but it carries no security guarantee.

**Rationale.** Holding the epoch authoritatively in MySQL makes password change and session invalidation atomic in one datastore and removes any need for cross datastore transactional tricks. Redis remains the fast session store; MySQL is the authority for whether a session generation is still valid.

**Implementation note.** The epoch check on an authenticated request is a single primary key read of the `users` row. Session rotation on login and password change issues a new session id with a fresh absolute window.

---

### V4: Audio asset storage and serving path

**Decision.** Pre generated audio is stored on local disk on the VPS, served by Nginx, cached at the Cloudflare edge, with content addressed immutable filenames, behind a small storage abstraction.

**Rationale.** The dataset is modest and the assets are immutable, so content addressed files take long lived cache headers and the edge serves almost everything. Object storage adds a dependency for no benefit at this size. This matches `FR-CONTENT-04`, which already expects a file on disk at an expected path with a recorded SHA-256.

**Implementation note.** Audio storage is reached through a storage port that domain logic depends on, with the concrete filesystem adapter living alongside the other infrastructure clients (a `storage` or `adapters/storage` module, not `repositories/`, which C4 reserves for database access). A later object storage backend is then a new adapter behind the same port, with no reach into domain logic. This keeps `repositories/` from becoming a home for non database access.

---

### V5: Transactional email provider

**Decision.** Brevo, provisional pending verification of its DPA and subprocessor documentation.

**Rationale.** Only transactional mail is sent, verification, password reset, and deletion confirmation, at low volume. Brevo offers a permanent free tier well above launch needs. The selection rests on suitable EU oriented processing arrangements verified through the DPA and subprocessor list, adequate transactional limits, deliverability, and API and SMTP quality. Permanent log retention is not treated as an advantage, since long retention conflicts with data minimisation, and EU headquartering does not by itself remove standard contractual clause concerns, because an EU company can still route through non EU subprocessors.

**Implementation note.** The provider is a subprocessor to name in the privacy policy and processing records. This decision remains provisional until the DPA and subprocessor verification is complete.

---

### V6: Off site backup target

**Decision.** Backblaze B2, an off provider target, for the retained backups. Backups are encrypted, use separate credentials the production role does not hold, are restore tested on a schedule, and use Object Lock or equivalent immutable retention.

**Rationale.** `NFR-OPS-01` wants off site backups with daily times 30 plus weekly times 26 and an RPO within 24 hours. Off site should mean off provider for disaster isolation, since a same provider target survives a disk failure but not an account or provider level incident, and at this data size the cost difference is negligible, so isolation decides. A backup that cannot be restored or can be wiped with the production credentials is not a backup, hence the encryption, credential separation, restore testing, and immutable retention.

**Implementation note.** The erasure jobs' `DELETE` credential is distinct from the backup credential; neither is a general privileged user.

---

### V7: Hetzner region

**Decision.** An EU Hetzner region, chosen among the EU locations on current availability, price, and measured latency while preserving EU residency, rather than hard coding a specific city as architecture.

**Rationale.** The audience is EU first and the primary regime is GDPR, with a Turkish secondary base. An Ashburn US region pulls personal data across the Atlantic for no benefit to the audience and is out. Keeping processing in the EU simplifies the GDPR story, and the difference between the EU locations is marginal.

---

### V8: Profanity blocklist package

**Decision.** obscenity, MIT licensed, kept behind the project's own username policy interface.

**Rationale.** `FR-AUTH-05` and Appendix A reject profane usernames, and Round 4 Decision 4 settled on a default list plus admin synonyms plus an external blocklist, which obscenity's extensibility matches. Usernames are a hostile surface where people deliberately obfuscate, and obscenity handles leetspeak, repeated characters, and similar obfuscation. Its transformers are text normalisation steps, not Transformer or machine learning models. Given the restricted username charset, homoglyph attacks are already constrained.

**Implementation note.** The reserved username list from Appendix A and this filter run as two checks in the same validation path. Keeping the package behind the username policy interface makes replacing it later cheap. Budget for the false positive case using its whitelist.

---

## 5. Decisions that remain as previously settled

- **V5 is provisional**, pending the DPA and subprocessor verification (see §4, V5).
- Foundational Decisions (SRS Round 1) and the Round 4 Decisions are unchanged and are not reopened.
- `NFR-OPS-04` stands as merged (D8): application logs 90 days at launch reducing to 30 when stable, access logs 30 days.

---

## 6. Amendment Ledger

Changes to settled requirement text implied by the decisions above. Per D7, each amendment is produced against the authoritative document rather than left as a contradiction. These are logged here, to be applied in a dedicated amendment pass, not drafted in this document. Items 1 through 9 are the original ledger; items 10 through 14 are the follow-up addendum (v1.0.3) from the full-SRS reconciliation against this baseline, which surfaced consequences the original nine missed. The architecture sections are unchanged.

1. **`FR-AUTH-18`**: reword the merge mechanism from re pointing `user_activity_events.anonymous_id` to appending an identity binding, with event rows unchanged. Follow-up: this also corrects the SRS closing footer, which still describes the merge as re-pointing and calls the FR-SAVE-03 / FR-AUTH-18 tension "intentionally left unresolved"; the footer is updated to record the B1 resolution.
2. **`FR-AUTH-19`**: verify only. Its cross device merge semantics remain unchanged; each anonymous identity is linked independently to the authenticated account under the B1 at most one user per anonymous identity invariant. Any latest wins rule applies only to state resolution after identities belonging to the same account are merged, not to reassignment of an anonymous identity between users.
3. **`FR-SAVE-03`**: expand the `INSERT` and `SELECT` only privilege guarantee to cover both history of record tables, `user_activity_events` and `identity_bindings`, keeping the event type vocabularies of the two tables separate (`LINK` belongs to `identity_bindings`, not to the `user_activity_events` enumeration). Follow-up refinement: the destructive privilege is the narrow erasure credential, confined to what erasure requires, not blanket `UPDATE` and `DELETE` on every history table; the exact destructive surface is left to the deletion-flow and schema design.
4. **`NFR-PERF-05`**: re annotate the composition query set; user state and the progress banner count move off the shell onto the B2 hydration endpoint. Follow-up refinement: state no numeric budget for the hydration endpoint, since Round 1 sets none; the shell keeps its 50 ms budget and the hydration path is measured separately.
5. **SDD data model**: introduce `identity_bindings` (LINK only, no `UNLINK` reservation), the `current_identity_bindings` SQL view, `DATETIME(3)` plus `BIGINT event_id`, and the claim and status columns the idempotent jobs require. Not an SRS amendment; recorded so the data model round carries it.
6. **`FR-IPA-08`**: reword the acceptance criterion per FIND-01 (target phoneme present anywhere in the transcription, preferring initial position where permitted); FIND-01 moves from Open to Scheduled.
7. **`FR-CONTENT-04`**: require per audio asset licence, author, attribution text, and retrieval date, plus a validate stage licence compatibility gate assessed against intended use and processing.
8. **`FR-CONTENT-05`**: provide audio attribution in the manner the asset's licence requires, separate from the meaning attribution; placement is a UX decision.
9. **`FR-WORD-03`** (corrected from `FR-WORD-05`, which is word-request capture): render pronunciations in stored `display_order` led by `is_primary`; the schema adds `is_primary` and `display_order`, validated at ingestion. The whole-word audio presentation for secondary pronunciations is not settled here and is flagged as an SDD or UX design decision.

Follow-up addendum (v1.0.3), discovered during the full-SRS reconciliation against this baseline. These are additional SRS amendments, not architecture changes.

10. **`FR-WORD-04`**: replace the hardcoded Levenshtein distance ≤ 2 with a behavioural fuzzy-match requirement covering both typographical errors (including adjacent transpositions) and phonetic misspellings; the exact algorithm (Optimal String Alignment plus Double Metaphone, per E3) is owned by the SDD.
11. **`FR-SAVE-03`, `FR-SAVE-04`, `FR-AUTH-18`**: reconcile the event model to C5. The event ID becomes `event_id` (`BIGINT AUTO_INCREMENT`), the timestamp becomes `occurred_at` (`DATETIME(3)`, UTC), deterministic latest-event resolution orders by `(occurred_at, event_id)`, and the prior claims that a same-millisecond collision makes a tie-breaker unnecessary are corrected to state that the monotonic `event_id` is the tie-breaker.
12. **`FR-IPA-03`**: apply the FIND-01 correction consistent with `FR-IPA-08`: the example word must genuinely contain the target phoneme, preferring a word-initial example where the phoneme naturally occurs word-initially and it is pedagogically useful, and not requiring initial position for phonemes such as `/ŋ/` or `/ʒ/`. Body and acceptance criterion updated.
13. **`FR-SET-08`**: hard-delete erasure includes `identity_bindings` rows binding the user's anonymous identities to the account, and the user-owned event subset it purges is understood to include events originating from those bound anonymous identities. No `UNLINK` event is introduced; v1.0 remains LINK only.
14. **Appendix E and `NFR-PRIV-02`**: add the anonymous-to-account binding (`identity_bindings`) to the normative PII inventory, justified by `FR-AUTH-18`, and to the retention table, with the rule that a bound anonymous identity follows the account lifecycle (deleted on hard-delete, never dormancy-pruned) while the dormancy prune applies to unbound anonymous UUIDs. `NFR-PRIV-01` needs no text change; the Appendix E addition satisfies it.

---

## 7. Open items carried forward

- **V1 pre scale and legal confirmation** of the generated WAV licensing status, and the espeak-ng phonemizer note, before meaningful scale or commercial exposure. Speaker id selection from the `en_US-libritts-high` model.
- **V5 DPA and subprocessor verification** before Brevo is treated as settled.
- **FIND-01** scheduled for the Iteration 2 seed validation test.
- **Cloud fallback order** recorded (AWS Polly, then Google, then Azure not preferred) should the Piper plus libritts route prove inadequate on quality or coverage.
- **Whole-word audio for secondary pronunciations** (`FR-WORD-03`) is an open UX or SDD design decision, not settled in Round 1.
- **The exact destructive-privilege surface of the erasure credential** (`FR-SAVE-03`, deletion worker) is left to the deletion-flow and schema design; Round 1 fixes only that it is narrow and least-privilege.

---

## 8. Round 1 status and next step

The entire Round 1 inventory from SDD Handoff §6 is settled: three blocking resolutions (§1), six cross cutting conventions (§2), four content and algorithm decisions (§3), eight vendor and infrastructure picks (§4), and the amendment ledger (§6), now fourteen items after the v1.0.3 follow-up addendum, with V5 provisional and the open items in §7 tracked.

Next deliverable is **SDD Round 2: architecture and cross cutting** (SDD sections 1, 2, 3, 6, and 7). Upload this document alongside the §9 document set from the SDD Handoff to begin Round 2.

---

*End of SDD Round 1 Decisions Document.*
