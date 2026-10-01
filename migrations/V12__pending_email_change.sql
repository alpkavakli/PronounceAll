-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Changing an account's email (Iteration 6; FR-SET-02, FR-AUTH-06).
-- Maintainer decision 2026-09-30: pending columns on user_accounts.
--
--   * `pending_email` / `pending_email_lower` — the address asked for, held
--     until its confirmation link is followed. The current `email` stays
--     active meanwhile (FR-SET-02). UNIQUE (pending_email_lower) reserves a
--     pending address against other pending changes; FR-AUTH-06 counts pending
--     addresses as in use, which the application checks across both columns,
--     and UNIQUE (email_lower) settles any race when the change is confirmed.
--   * `auth_tokens.token_type` gains `email_change` for the confirmation link.

ALTER TABLE user_accounts
  ADD COLUMN pending_email       VARCHAR(320) NULL AFTER email_verified_at,
  ADD COLUMN pending_email_lower VARCHAR(320) NULL AFTER pending_email,
  ADD UNIQUE KEY uq_user_accounts_pending_email_lower (pending_email_lower);

ALTER TABLE auth_tokens
  MODIFY COLUMN token_type ENUM('email_verification','password_reset','email_change') NOT NULL;
