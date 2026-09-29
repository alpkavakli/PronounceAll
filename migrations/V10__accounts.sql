-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Accounts: credentials, single-use tokens, and consent records (Iteration 4;
-- FR-AUTH-04/06/08/09/10/11/16, FR-CONSENT-03/04; SDD v1.1 §4.3, §4.7).
--
-- `users` already exists (V8) so its foreign keys were declared once; this
-- migration adds what hangs off it.
--
--   * `user_accounts` — one row per sign-in method of a user. `password_hash`
--     only for the password provider, `google_sub` only for google.
--     UNIQUE(email_lower) enforces FR-AUTH-06 across verified and pending emails.
--   * `auth_tokens` — email verification and password reset. Only the SHA-256
--     of the CSPRNG token is stored (NFR-SEC-10, NFR-SEC-12).
--   * `consent_records` — the no-recovery acknowledgement (FR-CONSENT-04), and
--     later the ad opt-in and account restoration records.
--
-- NOT HERE: sessions. They live in Redis, validated against
-- `users.session_epoch` (V3); there is no MySQL sessions table.
-- `deletion_audit` arrives with account deletion (Iteration 6).

CREATE TABLE user_accounts (
  account_id          BIGINT        NOT NULL AUTO_INCREMENT,
  user_id             BIGINT        NOT NULL,
  provider            ENUM('password','google') NOT NULL,
  email               VARCHAR(320)  NULL,
  email_lower         VARCHAR(320)  NULL,
  email_verified_at   DATETIME(3)   NULL,
  password_hash       CHAR(60)      NULL,
  google_sub          VARCHAR(255)  NULL,
  profile_picture_url VARCHAR(512)  NULL,
  created_at          DATETIME(3)   NOT NULL,
  updated_at          DATETIME(3)   NOT NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY uq_user_accounts_email_lower (email_lower),
  UNIQUE KEY uq_user_accounts_google_sub (google_sub),
  UNIQUE KEY uq_user_accounts_user_provider (user_id, provider),
  CONSTRAINT ck_user_accounts_credential CHECK (
    (provider = 'password' AND password_hash IS NOT NULL AND google_sub IS NULL)
    OR (provider = 'google' AND google_sub IS NOT NULL AND password_hash IS NULL)
  ),
  CONSTRAINT fk_user_accounts_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE auth_tokens (
  token_id    BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     BIGINT       NOT NULL,
  token_type  ENUM('email_verification','password_reset') NOT NULL,
  token_hash  CHAR(64)     NOT NULL,
  expires_at  DATETIME(3)  NOT NULL,
  consumed_at DATETIME(3)  NULL,
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (token_id),
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  -- Invalidating a user's prior unconsumed tokens of a type (FR-AUTH-10/11).
  KEY ix_auth_tokens_user_type (user_id, token_type, consumed_at),
  -- The nightly prune of expired tokens (NFR-PRIV-02).
  KEY ix_auth_tokens_expires (expires_at),
  CONSTRAINT fk_auth_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE consent_records (
  consent_id     BIGINT       NOT NULL AUTO_INCREMENT,
  user_id        BIGINT       NULL,
  anonymous_id   CHAR(36)     NULL,
  consent_type   ENUM('ads_opt_in','no_recovery_ack','account_restored') NOT NULL,
  consent_value  ENUM('granted','revoked','acknowledged') NOT NULL,
  policy_version VARCHAR(32)  NULL,
  recorded_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (consent_id),
  -- Latest consent per actor and type in one indexed lookup (FR-CONSENT-03).
  KEY ix_consent_records_user (user_id, consent_type, recorded_at),
  KEY ix_consent_records_anonymous (anonymous_id, consent_type, recorded_at),
  CONSTRAINT ck_consent_records_one_owner CHECK ((anonymous_id IS NULL) <> (user_id IS NULL)),
  CONSTRAINT ck_consent_records_ads_policy
    CHECK (consent_type <> 'ads_opt_in' OR policy_version IS NOT NULL),
  CONSTRAINT fk_consent_records_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_consent_records_anonymous
    FOREIGN KEY (anonymous_id) REFERENCES anonymous_profiles (anonymous_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
