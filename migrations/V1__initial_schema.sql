-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Iteration 0 baseline schema.
--
-- Governed by SDD v1.1 §4.2 (catalogue and content tables), decision C3
-- (Flyway owns schema migrations), and §7.2 (snake_case identifiers, plural
-- table names, singular columns, all temporal columns in UTC).
--
-- An applied migration is immutable. A correction is a NEW migration, never an
-- edit of this file — that is exactly what the Flyway checksum guards.
--
-- Only `language_variants` is created here. The remaining tables of SDD §4.2 to
-- §4.7 arrive with the iteration that first reads or writes them, so no table
-- ships ahead of its code.

CREATE TABLE language_variants (
  variant_id   SMALLINT     NOT NULL AUTO_INCREMENT,
  code         VARCHAR(16)  NOT NULL,
  display_name VARCHAR(64)  NOT NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (variant_id),
  UNIQUE KEY uq_language_variants_code (code)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
