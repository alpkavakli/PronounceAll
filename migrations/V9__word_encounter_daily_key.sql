-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- One word encounter per owner, word and UTC day (FR-SAVE-10; SDD v1.1 §4.4,
-- amendment 2026-09-17).
--
-- The limit is enforced by the database, not by a read before the write, so
-- two concurrent tabs cannot both record one. `encounter_day_key` is a stored
-- generated column that is non-null ONLY for a `word_encounter` row, composed of
-- the owner, the target and the UTC date of `occurred_at` (the application
-- writes `occurred_at` in UTC, C5). Every other event type leaves it NULL, which
-- a unique index tolerates, so no other event is constrained.
--
-- The encounter service inserts and treats the duplicate-key error as the
-- specified no-op. No row is ever updated or deleted to enforce the limit.
--
-- The owner is prefixed by its kind (`a:` anonymous, `u:` user) so an anonymous
-- id and a user id can never produce the same key.

ALTER TABLE user_activity_events
  ADD COLUMN encounter_day_key VARCHAR(96)
    GENERATED ALWAYS AS (
      IF(
        event_type = 'word_encounter',
        CONCAT(
          IF(anonymous_id IS NOT NULL, CONCAT('a:', anonymous_id), CONCAT('u:', user_id)),
          ':', target_kind, ':', target_id, ':', DATE(occurred_at)
        ),
        NULL
      )
    ) STORED,
  ADD UNIQUE KEY uq_user_activity_events_encounter_day (encounter_day_key);
