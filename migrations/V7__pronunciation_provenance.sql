-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Per-pronunciation provenance (E1, E4, FR-CONTENT-05, SDD §4.2).
--
-- WHY THIS EXISTS
-- ---------------
-- Provenance was recorded only on `words`: the Wiktionary entry that supplied
-- the meaning also supplied every pronunciation, so one attribution was true
-- for both. The source-normalization batch of 2026-09-16 found eleven words
-- whose only Wiktionary pronunciation is British and whose General American
-- form exists only in the CMU Pronouncing Dictionary. Storing that form under
-- the word-level Wiktionary attribution would misattribute it.
--
-- So a pronunciation may now name its own source. The design follows the
-- existing schema pattern — `audio_assets` and `phoneme_example_words` carry
-- provenance on the row it describes — rather than introducing a shared source
-- table for a single second source.
--
--   * `source_kind` defaults to `wiktionary`, which is true of every existing
--     row. A `wiktionary` row inherits `words.source_url` and
--     `words.source_licence` and carries no duplicate metadata.
--   * Any other kind must carry its own `source_reference` and
--     `licence_identifier`; the CHECK makes an unattributed non-Wiktionary row
--     unstorable. Dataset-level provenance (upstream commit, checksum, licence
--     text, retrieval date) lives in the committed seed artifact for that
--     source.
--
-- `word_pronunciations.source_ipa` remains rejected (SDD §4.12): raw upstream
-- notation stays in the seed artifacts, not in a runtime column.
--
-- SAFETY
-- ------
-- Additive only. The default backfills every existing row, and the natural key,
-- ordering and primary constraints are untouched.

ALTER TABLE word_pronunciations
  ADD COLUMN source_kind        ENUM('wiktionary','cmudict') NOT NULL DEFAULT 'wiktionary' AFTER display_order,
  ADD COLUMN source_reference   VARCHAR(512)                 NULL AFTER source_kind,
  ADD COLUMN licence_identifier VARCHAR(64)                  NULL AFTER source_reference,
  ADD CONSTRAINT ck_word_pronunciations_source_attributed CHECK (
    source_kind = 'wiktionary'
    OR (source_reference IS NOT NULL AND licence_identifier IS NOT NULL)
  );
