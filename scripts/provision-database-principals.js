/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Provision the least-privilege database principals (SDD v1.1 §4.9 with its
 * 2026-10-01 amendment; Threat Model F3; B1, C6, V6).
 *
 * Idempotent and convergent: for each principal it creates the user if
 * missing, sets the password from the environment, revokes everything, then
 * grants exactly its §4.9 set — so a rerun after any drift restores the
 * design, and a password rotation is a rerun with a new value.
 *
 * Run as an administrative MySQL account, against the application schema
 * (MYSQL_DATABASE). Bootstrap order on a fresh server:
 *   1. node scripts/provision-database-principals.js --only=pa_migrate
 *   2. Flyway migrate as pa_migrate
 *   3. node scripts/provision-database-principals.js        (all of them)
 * Table-level grants need the tables to exist, hence the two passes.
 *
 * Environment: PROVISION_MYSQL_USER / PROVISION_MYSQL_PASSWORD (the admin),
 * MYSQL_HOST / MYSQL_PORT / MYSQL_DATABASE, and one PA_<NAME>_PASSWORD per
 * principal provisioned (PA_APP_PASSWORD, PA_ERASE_PASSWORD, ...). No password
 * is ever printed.
 *
 * Usage: node scripts/provision-database-principals.js [--only=pa_app,pa_erase]
 */

import process from 'node:process';

import mysql from 'mysql2/promise';

import { config } from '../src/config/index.js';

/** The catalogue tables (§4.2): content, no personal data. */
const CATALOGUE_SELECT = [
  'GRANT SELECT ON language_variants TO ?@?',
  'GRANT SELECT ON words TO ?@?',
  'GRANT SELECT ON word_pronunciations TO ?@?',
  'GRANT SELECT ON pronunciation_phonemes TO ?@?',
  'GRANT SELECT ON phonemes TO ?@?',
  'GRANT SELECT ON phoneme_example_words TO ?@?',
  'GRANT SELECT ON audio_assets TO ?@?',
];

/** Every grant, per principal, exactly as §4.9 lists it. */
const GRANTS = Object.freeze({
  pa_app: [
    ...CATALOGUE_SELECT,
    // Append-only history (FR-SAVE-03, B1): INSERT and SELECT, never UPDATE or DELETE.
    'GRANT INSERT, SELECT ON user_activity_events TO ?@?',
    'GRANT INSERT, SELECT ON identity_bindings TO ?@?',
    'GRANT SELECT ON current_identity_bindings TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON user_word_states TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON user_phoneme_states TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON sm2_states TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON practice_sessions TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON practice_attempts TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON users TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON user_accounts TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON anonymous_profiles TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON consent_records TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON auth_tokens TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON word_requests TO ?@?',
  ],
  pa_erase: [
    'GRANT SELECT, DELETE ON users TO ?@?',
    'GRANT SELECT, DELETE ON user_accounts TO ?@?',
    'GRANT SELECT, DELETE ON auth_tokens TO ?@?',
    'GRANT SELECT, DELETE ON anonymous_profiles TO ?@?',
    'GRANT SELECT, DELETE ON identity_bindings TO ?@?',
    'GRANT SELECT, DELETE ON user_activity_events TO ?@?',
    'GRANT SELECT, DELETE ON user_word_states TO ?@?',
    'GRANT SELECT, DELETE ON user_phoneme_states TO ?@?',
    'GRANT SELECT, DELETE ON sm2_states TO ?@?',
    'GRANT SELECT, DELETE ON practice_sessions TO ?@?',
    'GRANT SELECT, DELETE ON practice_attempts TO ?@?',
    'GRANT SELECT, DELETE ON consent_records TO ?@?',
    // The two C6 claims: exactly the columns they flip.
    'GRANT UPDATE (deletion_state) ON users TO ?@?',
    'GRANT UPDATE (prune_claimed_at) ON anonymous_profiles TO ?@?',
    'GRANT SELECT, UPDATE (submitted_by_user_id, submitted_by_anonymous_id) ON word_requests TO ?@?',
    'GRANT INSERT ON deletion_audit TO ?@?',
  ],
  pa_maint: ['GRANT SELECT, DELETE ON auth_tokens TO ?@?'],
  pa_seed: [
    'GRANT INSERT, UPDATE, SELECT ON language_variants TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON words TO ?@?',
    'GRANT INSERT, UPDATE, SELECT, DELETE ON word_pronunciations TO ?@?',
    'GRANT INSERT, UPDATE, SELECT, DELETE ON pronunciation_phonemes TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON phonemes TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON phoneme_example_words TO ?@?',
    'GRANT INSERT, UPDATE, SELECT ON audio_assets TO ?@?',
    'GRANT SELECT, UPDATE (status) ON word_requests TO ?@?',
  ],
  pa_backup: ['GRANT SELECT, SHOW VIEW, TRIGGER ON * TO ?@?'],
  // Measured on a fresh database: the least that applies every migration
  // (amendment 2026-10-01). CREATE on each table grant only makes it legal
  // before the table exists; the schema-level CREATE already covers it.
  pa_migrate: [
    'GRANT CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW ON * TO ?@?',
    // Flyway's own history, including `flyway repair`.
    'GRANT CREATE, SELECT, INSERT, UPDATE, DELETE ON flyway_schema_history TO ?@?',
    // V2 seeds the language variants.
    'GRANT CREATE, INSERT ON language_variants TO ?@?',
    // The V8 view runs with its creator's rights (SQL SECURITY DEFINER).
    'GRANT CREATE, SELECT ON identity_bindings TO ?@?',
  ],
});

/** The password variable of each principal. */
const PASSWORD_VARIABLE = Object.freeze({
  pa_app: 'PA_APP_PASSWORD',
  pa_erase: 'PA_ERASE_PASSWORD',
  pa_maint: 'PA_MAINT_PASSWORD',
  pa_seed: 'PA_SEED_PASSWORD',
  pa_backup: 'PA_BACKUP_PASSWORD',
  pa_migrate: 'PA_MIGRATE_PASSWORD',
});

const HOST = '%';

/**
 * @param {import('mysql2/promise').Connection} connection admin, with the application schema selected
 * @param {Record<string, string>} passwords principal → password
 */
export async function provisionPrincipals(connection, passwords) {
  for (const [principal, password] of Object.entries(passwords)) {
    const grants = GRANTS[principal];
    if (!grants) throw new Error(`Unknown principal ${principal}`);
    if (typeof password !== 'string' || password.length < 16) {
      throw new Error(`${PASSWORD_VARIABLE[principal]} must be at least 16 characters`);
    }
    await connection.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [principal, HOST, password]);
    await connection.query('ALTER USER ?@? IDENTIFIED BY ?', [principal, HOST, password]);
    await connection.query('REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?', [principal, HOST]);
    for (const grant of grants) await connection.query(grant, [principal, HOST]);
  }
}

async function main() {
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).split(',');
  const principals = only ?? Object.keys(GRANTS);
  const passwords = Object.fromEntries(principals.map((principal) => [principal, process.env[PASSWORD_VARIABLE[principal]]]));

  const connection = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    database: config.mysql.database,
    user: process.env.PROVISION_MYSQL_USER,
    password: process.env.PROVISION_MYSQL_PASSWORD,
    multipleStatements: false,
  });
  try {
    await provisionPrincipals(connection, passwords);
    process.stdout.write(`Provisioned ${principals.join(', ')} on ${config.mysql.database}.\n`);
  } finally {
    await connection.end();
  }
}

if (process.argv[1]?.endsWith('provision-database-principals.js')) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
