-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Save/tag state: identity, the append-only event log, and derived state
-- (Iteration 3; FR-SAVE-01..05, FR-AUTH-03, B1, B3, C5; SDD v1.1 §4.3–§4.5, §4.8).
--
-- WHAT THIS CREATES
-- -----------------
--   * `users` — the pseudonymous identity row that events, bindings and state
--     reference. Iteration 3 writes none; authentication (Iteration 4) does.
--     The table exists now so the foreign keys below are declared once, as the
--     SDD specifies them, rather than retrofitted onto populated tables.
--   * `anonymous_profiles` — created only on the first write from a `pa_uid`
--     (FR-AUTH-03), never on a read.
--   * `identity_bindings` and the `current_identity_bindings` view — the B1
--     append-only LINK history and its resolution view. Empty until Iteration 4.
--   * `user_activity_events` — the append-only log (FR-SAVE-03). The runtime
--     role holds INSERT and SELECT only (SDD §4.9); nothing here updates or
--     deletes a row.
--   * `user_word_states`, `user_phoneme_states` — the derived projection of the
--     latest qualifying event, upserted in the same transaction as the event
--     (B3, FR-SAVE-04). An unsave is the value `unsaved`, never a deletion.
--
-- NOT HERE
-- --------
--   * `user_accounts`, `auth_tokens`, sessions — Iteration 4.
--   * `sm2_states`, practice tables — Iteration 5.
--   * The `word_encounter` per-day unique key (FR-SAVE-10) — added by the
--     encounter slice, which is gated on its privacy obligations.
--
-- Foreign keys to user-owned data are ON DELETE RESTRICT: erasure deletes
-- children before parents explicitly under the erasure credential (SDD §4.9).

CREATE TABLE users (
  user_id                  BIGINT       NOT NULL AUTO_INCREMENT,
  username                 VARCHAR(20)  NOT NULL,
  username_lower           VARCHAR(20)  NOT NULL,
  session_epoch            INT          NOT NULL DEFAULT 0,
  deletion_state           ENUM('none','soft_deleted','hard_delete_scheduled','hard_delete_in_progress')
                                        NOT NULL DEFAULT 'none',
  soft_deleted_at          DATETIME(3)  NULL,
  hard_delete_scheduled_at DATETIME(3)  NULL,
  created_at               DATETIME(3)  NOT NULL,
  updated_at               DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_username_lower (username_lower)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE anonymous_profiles (
  anonymous_id     CHAR(36)    NOT NULL,
  created_at       DATETIME(3) NOT NULL,
  last_seen_at     DATETIME(3) NOT NULL,
  prune_claimed_at DATETIME(3) NULL,
  PRIMARY KEY (anonymous_id),
  -- Dormancy selection (NFR-PRIV-02, SDD §4.8).
  KEY ix_anonymous_profiles_last_seen (last_seen_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE identity_bindings (
  binding_id   BIGINT        NOT NULL AUTO_INCREMENT,
  anonymous_id CHAR(36)      NOT NULL,
  user_id      BIGINT        NOT NULL,
  event_type   ENUM('LINK')  NOT NULL,
  occurred_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (binding_id),
  -- At most one LINK per anonymous identity (B1).
  UNIQUE KEY uq_identity_bindings_anonymous (anonymous_id),
  KEY ix_identity_bindings_user (user_id),
  CONSTRAINT fk_identity_bindings_anonymous
    FOREIGN KEY (anonymous_id) REFERENCES anonymous_profiles (anonymous_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_identity_bindings_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE VIEW current_identity_bindings AS
  SELECT anonymous_id, user_id FROM identity_bindings;

CREATE TABLE user_activity_events (
  event_id     BIGINT        NOT NULL AUTO_INCREMENT,
  anonymous_id CHAR(36)      NULL,
  user_id      BIGINT        NULL,
  target_kind  ENUM('word','phoneme') NOT NULL,
  target_id    BIGINT        NOT NULL,
  event_type   ENUM('save','unsave','tag_change','audio_listen_word','audio_listen_phoneme',
                    'practice_attempt','word_encounter') NOT NULL,
  event_value  VARCHAR(16)   NULL,
  occurred_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (event_id),
  -- Latest-event resolution and merge recompute, per owner (SDD §4.8, C5).
  KEY ix_user_activity_events_user (user_id, target_kind, target_id, occurred_at, event_id),
  KEY ix_user_activity_events_anonymous (anonymous_id, target_kind, target_id, occurred_at, event_id),
  CONSTRAINT ck_user_activity_events_one_owner
    CHECK ((anonymous_id IS NULL) <> (user_id IS NULL)),
  CONSTRAINT fk_user_activity_events_anonymous
    FOREIGN KEY (anonymous_id) REFERENCES anonymous_profiles (anonymous_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_activity_events_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE user_word_states (
  state_id      BIGINT        NOT NULL AUTO_INCREMENT,
  user_id       BIGINT        NULL,
  anonymous_id  CHAR(36)      NULL,
  word_id       BIGINT        NOT NULL,
  state         ENUM('unsaved','saved','learning','learned') NOT NULL,
  last_event_id BIGINT        NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (state_id),
  -- Partial keys: a unique index tolerates the NULL owner column (SDD §4.5).
  UNIQUE KEY uq_user_word_states_user (user_id, word_id),
  UNIQUE KEY uq_user_word_states_anonymous (anonymous_id, word_id),
  CONSTRAINT ck_user_word_states_one_owner
    CHECK ((anonymous_id IS NULL) <> (user_id IS NULL)),
  CONSTRAINT fk_user_word_states_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_word_states_anonymous
    FOREIGN KEY (anonymous_id) REFERENCES anonymous_profiles (anonymous_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_word_states_word
    FOREIGN KEY (word_id) REFERENCES words (word_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_word_states_event
    FOREIGN KEY (last_event_id) REFERENCES user_activity_events (event_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE user_phoneme_states (
  state_id      BIGINT        NOT NULL AUTO_INCREMENT,
  user_id       BIGINT        NULL,
  anonymous_id  CHAR(36)      NULL,
  phoneme_id    BIGINT        NOT NULL,
  state         ENUM('unsaved','saved','learning','learned') NOT NULL,
  last_event_id BIGINT        NOT NULL,
  updated_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (state_id),
  UNIQUE KEY uq_user_phoneme_states_user (user_id, phoneme_id),
  UNIQUE KEY uq_user_phoneme_states_anonymous (anonymous_id, phoneme_id),
  -- The FR-WORD-06 learned count is a filtered count per owner (SDD §4.8).
  KEY ix_user_phoneme_states_user_state (user_id, state),
  KEY ix_user_phoneme_states_anonymous_state (anonymous_id, state),
  CONSTRAINT ck_user_phoneme_states_one_owner
    CHECK ((anonymous_id IS NULL) <> (user_id IS NULL)),
  CONSTRAINT fk_user_phoneme_states_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_phoneme_states_anonymous
    FOREIGN KEY (anonymous_id) REFERENCES anonymous_profiles (anonymous_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_phoneme_states_phoneme
    FOREIGN KEY (phoneme_id) REFERENCES phonemes (phoneme_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_phoneme_states_event
    FOREIGN KEY (last_event_id) REFERENCES user_activity_events (event_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
