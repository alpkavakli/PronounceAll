-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Iteration 2 — IPA system and audio.
--
-- Governed by SDD v1.1 §4.2 (catalogue and content tables), §4.8 (indexing),
-- §4.9 (referential actions), §4.12 (resolved items), decisions E1, E2, E4, C6,
-- V1, V4, and FR-IPA-01/02/03/08, FR-CONTENT-02/03/04, FR-WORD-03.
-- The canonical inventory itself is D4, docs/current/
-- PronounceAll_en-US_Phoneme_Inventory_v1.md.
--
-- An applied migration is immutable. A correction is a NEW migration, never an
-- edit of this file — that is exactly what the Flyway checksum guards.
--
-- CIRCULAR REFERENCE, RESOLVED WITHOUT CASCADES
-- --------------------------------------------
-- `phonemes.primary_example_word_id` references `phoneme_example_words`, whose
-- own `phoneme_id` references `phonemes`. Neither table can therefore be created
-- with both constraints in place. The order below is deliberate:
--
--   1. create `phonemes` with `primary_example_word_id` NULLABLE and NO foreign
--      key;
--   2. create `phoneme_example_words` with its FK to `phonemes`;
--   3. ALTER `phonemes` to add the foreign key, now that its target exists.
--
-- The column stays nullable at INSERT only, to let the seed transaction insert
-- the phoneme, then its example words, then set the pointer. The seed validator
-- asserts it is non-null at completion (SDD §4.2). It is a seed invariant, never
-- a runtime nullable state. No `ON DELETE CASCADE` is used anywhere: §4.9
-- requires the destructive surface to stay explicit and auditable.
--
-- STAGED COLUMN COMPLETED HERE
-- ---------------------------
-- `word_pronunciations.whole_word_audio_asset_id` was deliberately omitted by
-- V3 (Iteration 1 Handoff §8.3) because `audio_assets` did not exist. It is
-- added at the end of this migration, which is the iteration that creates that
-- table. The schema now converges exactly on SDD §4.2.
--
-- Still NOT added, and still rejected for v1.0 (SDD §4.12):
--   * `phonemes.is_active`
--   * `word_pronunciations.source_ipa`

-- ---------------------------------------------------------------------------
-- audio_assets (FR-CONTENT-03/04, V1, V4, E4, C6)
-- ---------------------------------------------------------------------------
-- `UNIQUE (asset_key)` plus `generation_status` IS the C6 idempotency mechanism
-- for the TTS batch: two workers that both observe a missing asset cannot both
-- generate it, because the claim is an atomic compare-and-set on
-- `generation_status` under the unique key.
--
-- `storage_key` is content-addressed and immutable (V4), so a regenerated asset
-- is a NEW file and a new row rather than an update. The columns that describe a
-- generated file are nullable until the asset is ready; a row in `pending` is a
-- real, claimed intent to generate, not a placeholder for missing content.
--
-- Provenance and licence are per asset because Wikimedia recordings carry their
-- own licences (E4, FR-CONTENT-04); `licence_identifier` is therefore NOT NULL
-- even before the file exists, since an asset whose licence is unknown must
-- never be scheduled for generation or distribution.

CREATE TABLE audio_assets (
  audio_asset_id    BIGINT                                             NOT NULL AUTO_INCREMENT,
  variant_id        SMALLINT                                           NOT NULL,
  asset_key         VARCHAR(255)                                       NOT NULL,
  storage_key       VARCHAR(255)                                       NULL,
  sha256            CHAR(64)                                           NULL,
  mime_type         VARCHAR(64)                                        NULL,
  byte_length       INT                                                NULL,
  generation_status ENUM('pending','claimed','ready','failed')         NOT NULL DEFAULT 'pending',
  source_kind       ENUM('wiktionary_human','tts_piper','tts_cloud')   NOT NULL,
  source_reference  VARCHAR(512)                                       NULL,
  author            VARCHAR(255)                                       NULL,
  licence_identifier VARCHAR(64)                                       NOT NULL,
  licence_url       VARCHAR(512)                                       NULL,
  attribution_text  VARCHAR(512)                                       NULL,
  retrieved_at      DATE                                               NULL,
  created_at        DATETIME(3)                                        NOT NULL,
  PRIMARY KEY (audio_asset_id),
  UNIQUE KEY uq_audio_assets_asset_key (asset_key),
  -- A unique index tolerates repeated NULLs, so many assets may be un-generated
  -- while every generated one still has a distinct content-addressed file.
  UNIQUE KEY uq_audio_assets_storage_key (storage_key),
  -- The generation batch selects work by status (C6).
  KEY ix_audio_assets_status (generation_status),
  CONSTRAINT fk_audio_assets_variant
    FOREIGN KEY (variant_id) REFERENCES language_variants (variant_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- A ready asset must be a real file: FR-CONTENT-04 requires a non-zero byte
  -- length, a digest, and a MIME type, and the database is where that stops
  -- being a convention.
  CONSTRAINT ck_audio_assets_ready_is_complete CHECK (
    generation_status <> 'ready' OR (
      storage_key IS NOT NULL
      AND sha256 IS NOT NULL
      AND mime_type IS NOT NULL
      AND byte_length IS NOT NULL
      AND byte_length > 0
    )
  )
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- phonemes (FR-IPA-01, FR-IPA-07/08, E2, D4)
-- ---------------------------------------------------------------------------
-- The `en-us` rows are seeded from the PronounceAll en-US Pedagogical IPA
-- Inventory v1 (D4), which is authoritative for the symbol set and the
-- transcription conventions. This table stores that inventory; it does not
-- define it, and the 41-unit count is a consequence of the documented list
-- rather than a constraint expressed here.
--
-- `frequency_rank` is DENSE and UNIQUE 1..N per variant (FR-IPA-01). It is
-- derived by the seed pipeline from canonical-token occurrence counts over the
-- supported corpus, ties broken by D4 canonical order (D4 §6). It is NOT the
-- document order of D4.
--
-- `ipa_symbol` takes an accent- and case-sensitive collation rather than the
-- table default: under `utf8mb4_0900_ai_ci` two symbols differing only by a
-- combining diacritic compare equal, which would let `UNIQUE (variant_id,
-- ipa_symbol)` silently reject a genuinely distinct unit.

CREATE TABLE phonemes (
  phoneme_id              BIGINT      NOT NULL AUTO_INCREMENT,
  variant_id              SMALLINT    NOT NULL,
  ipa_symbol              VARCHAR(16) COLLATE utf8mb4_0900_as_cs NOT NULL,
  frequency_rank          SMALLINT    NOT NULL,
  audio_asset_id          BIGINT      NOT NULL,
  -- Nullable at INSERT only, to break the circular reference below. The FK is
  -- added by the ALTER at the end of this file.
  primary_example_word_id BIGINT      NULL,
  PRIMARY KEY (phoneme_id),
  UNIQUE KEY uq_phonemes_variant_symbol (variant_id, ipa_symbol),
  UNIQUE KEY uq_phonemes_variant_rank (variant_id, frequency_rank),
  CONSTRAINT fk_phonemes_variant
    FOREIGN KEY (variant_id) REFERENCES language_variants (variant_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_phonemes_audio_asset
    FOREIGN KEY (audio_asset_id) REFERENCES audio_assets (audio_asset_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- phoneme_example_words (FR-IPA-03/08, E2, D4 §4)
-- ---------------------------------------------------------------------------
-- The displayed example is the `match_mode = 'sound'` row (FR-IPA-08). Seed
-- validation asserts the target phoneme appears somewhere in
-- `phonemic_transcription`, preferring a word-initial example where the phoneme
-- permits it and allowing any position otherwise — the FIND-01 fix (E2).
--
-- `source_reference` is NOT NULL because every example carries its own
-- attribution for CC BY-SA (E2, FR-CONTENT-05).

CREATE TABLE phoneme_example_words (
  example_word_id        BIGINT                     NOT NULL AUTO_INCREMENT,
  phoneme_id             BIGINT                     NOT NULL,
  example_word           VARCHAR(128)               NOT NULL,
  phonemic_transcription VARCHAR(256) COLLATE utf8mb4_0900_as_cs NOT NULL,
  match_mode             ENUM('sound','spelling')   NOT NULL,
  source_reference       VARCHAR(512)               NOT NULL,
  PRIMARY KEY (example_word_id),
  -- The stable ingestion upsert key, so a seed re-run converges.
  UNIQUE KEY uq_phoneme_example_words_natural (phoneme_id, example_word),
  CONSTRAINT fk_phoneme_example_words_phoneme
    FOREIGN KEY (phoneme_id) REFERENCES phonemes (phoneme_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- Now that `phoneme_example_words` exists, close the circular reference.
ALTER TABLE phonemes
  ADD CONSTRAINT fk_phonemes_primary_example_word
  FOREIGN KEY (primary_example_word_id) REFERENCES phoneme_example_words (example_word_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- pronunciation_phonemes (FR-WORD-03, FR-IPA-02, E1, D4 §5)
-- ---------------------------------------------------------------------------
-- Every rendered phoneme occurrence resolves to a stable `phoneme_id` through
-- this table rather than by reparsing the IPA string at render time. Each row is
-- ONE clickable element carrying its `data-phoneme-id`; ordered by `position` it
-- reproduces the transcription.
--
-- Tokenization is performed SERVER-SIDE at seed time using D4's longest-match
-- rules, so no IPA reparsing occurs at render and browser JavaScript never
-- linguistically parses IPA (root CLAUDE.md invariant).
--
-- The five diphthongs are atomic and occupy ONE row each. Other vowel-plus-R
-- combinations are compositional: the vowel in `car`, /ɑɹ/, is two rows.
-- Stress marks and syllable separators are permitted non-clickable marks and
-- are NEVER rows here (D4 §5.5).
--
-- The composite `(pronunciation_id, position)` is both the primary key and the
-- natural key, and is the ordered range read of SDD §4.8.

CREATE TABLE pronunciation_phonemes (
  pronunciation_id BIGINT   NOT NULL,
  position         SMALLINT NOT NULL,
  phoneme_id       BIGINT   NOT NULL,
  PRIMARY KEY (pronunciation_id, position),
  KEY ix_pronunciation_phonemes_phoneme (phoneme_id),
  CONSTRAINT fk_pronunciation_phonemes_pronunciation
    FOREIGN KEY (pronunciation_id) REFERENCES word_pronunciations (pronunciation_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pronunciation_phonemes_phoneme
    FOREIGN KEY (phoneme_id) REFERENCES phonemes (phoneme_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- word_pronunciations.whole_word_audio_asset_id (E4, FR-IPA-05, SDD §4.12)
-- ---------------------------------------------------------------------------
-- Completes the V3 staged migration. Nullable by design, not by staging: a
-- SECONDARY pronunciation is given an audio control only when an asset is known
-- to correspond to that specific pronunciation (SDD §4.12). Primary audio is
-- never reused for a secondary pronunciation, and where no matching asset
-- exists the column stays NULL and no control is rendered.

ALTER TABLE word_pronunciations
  ADD COLUMN whole_word_audio_asset_id BIGINT NULL AFTER display_order,
  ADD CONSTRAINT fk_word_pronunciations_audio_asset
  FOREIGN KEY (whole_word_audio_asset_id) REFERENCES audio_assets (audio_asset_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
