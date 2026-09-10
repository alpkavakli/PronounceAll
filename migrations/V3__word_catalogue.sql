-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Iteration 1 — word pages.
--
-- Governed by SDD v1.1 §4.2 (catalogue and content tables), §4.8 (indexing),
-- §4.9 (referential actions), decisions E4 and C3, and FR-WORD-01/02/03/05,
-- FR-CONTENT-01/05.
--
-- An applied migration is immutable. A correction is a NEW migration, never an
-- edit of this file — that is exactly what the Flyway checksum guards.
--
-- DELIBERATE STAGED MIGRATION (Iteration 1 Handoff §8.3)
-- ------------------------------------------------------
-- SDD §4.2 is the DESTINATION schema, not a requirement that every final
-- foreign key exist in the first migration that touches a table. Two columns
-- are therefore deliberately staged here, and no unrelated future table is
-- created merely to satisfy a future foreign key (the Iteration 0 rule: no
-- table ships ahead of its code):
--
--   1. `word_pronunciations.whole_word_audio_asset_id` is NOT created. Whole-
--      word audio is entirely Iteration 2 (Handoff §8.2); the column and its
--      FK → `audio_assets` arrive with that table.
--   2. `word_requests.submitted_by_user_id` IS created, nullable, WITHOUT its
--      FK → `users`, because there is no `users` table until the
--      authentication iteration, which adds the constraint.
--
-- Neither is a change to the final schema. The migrated schema still converges
-- exactly on SDD §4.2.

-- ---------------------------------------------------------------------------
-- words (E4, FR-WORD-01/02/03, FR-CONTENT-01/05)
-- ---------------------------------------------------------------------------
-- Meaning is stored at the word level with a single upstream attribution; a
-- full sense model is a post-v1.0 register idea (E4). `normalized_headword` is
-- the FR-WORD-02 canonical form (lower-cased, NFC, trimmed, allow-listed) and
-- is the column the URL resolves against.

CREATE TABLE words (
  word_id             BIGINT       NOT NULL AUTO_INCREMENT,
  variant_id          SMALLINT     NOT NULL,
  normalized_headword VARCHAR(128) NOT NULL,
  display_headword    VARCHAR(128) NOT NULL,
  meaning             TEXT         NOT NULL,
  source_url          VARCHAR(512) NOT NULL,
  source_licence      VARCHAR(64)  NOT NULL,
  retrieved_at        DATE         NOT NULL,
  PRIMARY KEY (word_id),
  -- E4 natural key, and the §4.8 index that serves the word-page lookup.
  UNIQUE KEY uq_words_variant_headword (variant_id, normalized_headword),
  CONSTRAINT fk_words_variant
    FOREIGN KEY (variant_id) REFERENCES language_variants (variant_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- word_pronunciations (E4, FR-WORD-03, SDD §4.2)
-- ---------------------------------------------------------------------------
-- Many rows per word, so heteronyms such as `lead` live under one word entry.
-- Exactly one primary per word and a deterministic order, both validated at
-- ingestion (E4, FR-WORD-03):
--
--   * `UNIQUE (word_id, display_order)` gives the deterministic order;
--   * the generated `is_primary_flag` — the word id when primary, NULL
--     otherwise — participating in `UNIQUE (word_id, is_primary_flag)` lets
--     MySQL enforce AT MOST one primary per word declaratively, since a unique
--     index tolerates repeated NULLs. The ingestion validator asserts EXACTLY
--     one, which the database alone cannot express.
--
-- `UNIQUE (word_id, ipa_transcription)` is the stable ingestion upsert key, so
-- a seed re-run converges rather than duplicating or re-identifying rows;
-- `is_primary` and `display_order` are updated by that upsert but are not the
-- row's content identity (E4).
--
-- `ipa_transcription` takes an accent- and case-sensitive collation rather than
-- the table default: under `utf8mb4_0900_ai_ci` two transcriptions differing
-- only by a combining diacritic compare equal, which would let the natural key
-- silently reject a genuinely distinct transcription.

CREATE TABLE word_pronunciations (
  pronunciation_id   BIGINT       NOT NULL AUTO_INCREMENT,
  word_id            BIGINT       NOT NULL,
  ipa_transcription  VARCHAR(256) COLLATE utf8mb4_0900_as_cs NOT NULL,
  syllable_breakdown VARCHAR(256) COLLATE utf8mb4_0900_as_cs NOT NULL,
  gloss              VARCHAR(128) NULL,
  is_primary         BOOLEAN      NOT NULL,
  display_order      SMALLINT     NOT NULL,
  is_primary_flag    BIGINT       GENERATED ALWAYS AS (IF(is_primary, word_id, NULL)) VIRTUAL,
  PRIMARY KEY (pronunciation_id),
  UNIQUE KEY uq_word_pronunciations_natural (word_id, ipa_transcription),
  UNIQUE KEY uq_word_pronunciations_order (word_id, display_order),
  UNIQUE KEY uq_word_pronunciations_primary (word_id, is_primary_flag),
  CONSTRAINT fk_word_pronunciations_word
    FOREIGN KEY (word_id) REFERENCES words (word_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- word_requests (FR-WORD-05, FR-CONTENT-07, SRS Appendix E, SDD §4.2)
-- ---------------------------------------------------------------------------
-- A duplicate submission increments `upvote_count` rather than inserting a row
-- (FR-WORD-05), which is what `UNIQUE (variant_id, normalized_word)` makes
-- atomic. `submitted_by_anonymous_id` is a nullable scalar with NO foreign key
-- by design: a fresh UUID may submit a request before any `anonymous_profiles`
-- row exists, since FR-AUTH-03 creates that row only on a progress write.
--
-- On account hard-delete `submitted_by_user_id` is nulled; on dormancy prune
-- `submitted_by_anonymous_id` is nulled; in both cases the request survives
-- ownerless (SRS Appendix E, FR-SET-08).

CREATE TABLE word_requests (
  request_id                BIGINT                                NOT NULL AUTO_INCREMENT,
  variant_id                SMALLINT                              NOT NULL,
  normalized_word           VARCHAR(128)                          NOT NULL,
  -- Staged per Handoff §8.3: nullable and without its FK → `users` until the
  -- authentication iteration creates that table and adds the constraint.
  submitted_by_user_id      BIGINT                                NULL,
  submitted_by_anonymous_id CHAR(36)                              NULL,
  upvote_count              INT                                   NOT NULL DEFAULT 1,
  status                    ENUM('open','accepted','rejected')    NOT NULL DEFAULT 'open',
  created_at                DATETIME(3)                           NOT NULL,
  updated_at                DATETIME(3)                           NOT NULL,
  PRIMARY KEY (request_id),
  -- §4.8: the dedup / up-vote key.
  UNIQUE KEY uq_word_requests_variant_word (variant_id, normalized_word),
  CONSTRAINT fk_word_requests_variant
    FOREIGN KEY (variant_id) REFERENCES language_variants (variant_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
