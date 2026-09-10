-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Correct the collation of `audio_assets.asset_key` (FR-CONTENT-02/04, C6, D4).
--
-- V4 is applied and immutable, so this correction is a NEW migration — exactly
-- what the Flyway checksum guards.
--
-- THE DEFECT
-- ----------
-- `asset_key` inherited the table default `utf8mb4_0900_ai_ci`, which is
-- ACCENT-INSENSITIVE. The deterministic key for phoneme audio embeds the IPA
-- symbol, so two canonical units whose symbols fold together under that
-- collation collide on `UNIQUE (asset_key)`.
--
-- They do collide. Under `utf8mb4_0900_ai_ci`, `ð` (U+00F0) compares EQUAL to
-- `d`, so `phoneme:en-us:d:tts_piper:…` and `phoneme:en-us:ð:tts_piper:…` were
-- one row. The Iteration 2 seed produced 40 audio assets for 41 phonemes, and
-- `/d/` and `/ð/` pointed at the same asset — they would have played the same
-- recording on the word page.
--
-- V4 already guarded `phonemes.ipa_symbol` and `word_pronunciations
-- .ipa_transcription` this way. `asset_key` was missed because it reads as an
-- opaque identifier rather than as a column carrying IPA; it carries both.
--
-- The rule, stated once: ANY column that can contain an IPA symbol — directly or
-- embedded in a composite key — takes `utf8mb4_0900_as_cs`. Accent-insensitive
-- comparison silently merges distinct phonemes, which is a content defect rather
-- than a storage detail.

ALTER TABLE audio_assets
  MODIFY COLUMN asset_key VARCHAR(255) COLLATE utf8mb4_0900_as_cs NOT NULL;

-- `storage_key` is a content-addressed hex digest plus an extension, so it holds
-- no IPA and needs no change. It is left alone deliberately rather than swept
-- along, so the reason for each collation stays legible.
