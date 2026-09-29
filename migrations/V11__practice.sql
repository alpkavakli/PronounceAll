-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Practice: SM-2 state, practice sessions and their attempts (Iteration 5;
-- FR-PRACTICE-01/03/04/05/06; SDD v1.1 §4.6, §5.4).
--
--   * `sm2_states` — one row per (owner, word) once the word is first
--     practised; a saved word with no row is due now (FR-PRACTICE-01).
--     `next_due_at` is second precision, UTC (FR-PRACTICE-04).
--   * `practice_sessions` — one per started session: the initial queue
--     snapshot, the idle deadline evidence (`last_interaction_at`) and, once
--     finalised, the end time and counts (FR-PRACTICE-06).
--   * `practice_attempts` — one accepted answer per served turn:
--     UNIQUE (session_id, turn_seq) is what makes a replayed or concurrent
--     answer to the same turn harmless (C6).
--
-- The live queue itself is not here: it is Redis-resident with a 60-minute
-- idle expiry, and MySQL is authoritative over it (SDD §5.4).

CREATE TABLE sm2_states (
  sm2_id           BIGINT        NOT NULL AUTO_INCREMENT,
  user_id          BIGINT        NULL,
  anonymous_id     CHAR(36)      NULL,
  word_id          BIGINT        NOT NULL,
  repetition_count INT           NOT NULL DEFAULT 0,
  ease_factor      DECIMAL(4,3)  NOT NULL DEFAULT 2.500,
  interval_days    INT           NOT NULL DEFAULT 0,
  next_due_at      DATETIME      NOT NULL,
  last_reviewed_at DATETIME(3)   NULL,
  updated_at       DATETIME(3)   NOT NULL,
  PRIMARY KEY (sm2_id),
  UNIQUE KEY uq_sm2_states_user (user_id, word_id),
  UNIQUE KEY uq_sm2_states_anonymous (anonymous_id, word_id),
  CONSTRAINT ck_sm2_states_one_owner CHECK ((anonymous_id IS NULL) <> (user_id IS NULL)),
  CONSTRAINT ck_sm2_states_ease_floor CHECK (ease_factor >= 1.300),
  CONSTRAINT fk_sm2_states_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sm2_states_anonymous
    FOREIGN KEY (anonymous_id) REFERENCES anonymous_profiles (anonymous_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sm2_states_word
    FOREIGN KEY (word_id) REFERENCES words (word_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE practice_sessions (
  session_id             BIGINT       NOT NULL AUTO_INCREMENT,
  user_id                BIGINT       NULL,
  anonymous_id           CHAR(36)     NULL,
  started_at             DATETIME(3)  NOT NULL,
  ended_at               DATETIME(3)  NULL,
  last_interaction_at    DATETIME(3)  NOT NULL,
  initial_queue_snapshot JSON         NOT NULL,
  total_attempts         INT          NOT NULL DEFAULT 0,
  correct_count          INT          NOT NULL DEFAULT 0,
  status                 ENUM('active','completed','timed_out','abandoned') NOT NULL DEFAULT 'active',
  PRIMARY KEY (session_id),
  -- The owner's live session, and the idle sweep (FR-PRACTICE-06).
  KEY ix_practice_sessions_user_status (user_id, status),
  KEY ix_practice_sessions_anonymous_status (anonymous_id, status),
  KEY ix_practice_sessions_status_idle (status, last_interaction_at),
  CONSTRAINT ck_practice_sessions_one_owner CHECK ((anonymous_id IS NULL) <> (user_id IS NULL)),
  CONSTRAINT fk_practice_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_practice_sessions_anonymous
    FOREIGN KEY (anonymous_id) REFERENCES anonymous_profiles (anonymous_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE practice_attempts (
  attempt_id   BIGINT       NOT NULL AUTO_INCREMENT,
  session_id   BIGINT       NOT NULL,
  word_id      BIGINT       NOT NULL,
  turn_seq     INT          NOT NULL,
  rating       ENUM('right','wrong') NOT NULL,
  attempted_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (attempt_id),
  UNIQUE KEY uq_practice_attempts_turn (session_id, turn_seq),
  CONSTRAINT fk_practice_attempts_session
    FOREIGN KEY (session_id) REFERENCES practice_sessions (session_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_practice_attempts_word
    FOREIGN KEY (word_id) REFERENCES words (word_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
