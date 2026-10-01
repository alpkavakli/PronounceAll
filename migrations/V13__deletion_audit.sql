-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- The erasure tombstone (Iteration 6; FR-SET-08, NFR-PRIV-02; SDD v1.1 §4.7).
--
-- One row per completed erasure: its own identifier, the kind, and when.
-- Nothing about the subject — no user id, no username, no email — so an
-- erasure is provable without retaining anything about who was erased.
-- Retained indefinitely.

CREATE TABLE deletion_audit (
  deletion_id   CHAR(36)     NOT NULL,
  deletion_type ENUM('hard_user','dormancy_anonymous') NOT NULL,
  completed_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (deletion_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
