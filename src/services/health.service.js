/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The health check (NFR-OPS-02 operability posture).
 *
 * A service, not a route, so the same check is reachable from an HTTP route, a
 * deployment smoke script, or a test without duplicating logic (C4: one
 * implementation, several entry points). Its dependencies arrive as arguments
 * rather than as imports of concrete infrastructure clients, keeping the
 * dependency direction of §7.3 intact.
 */

/**
 * @typedef {object} HealthReport
 * @property {'ok' | 'degraded'} status
 * @property {{ database: boolean, redis: boolean }} checks
 */

/**
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.pingDatabase
 * @param {() => Promise<boolean>} deps.pingRedis
 * @returns {Promise<HealthReport>}
 */
export async function checkHealth({ pingDatabase, pingRedis }) {
  const [database, redis] = await Promise.all([
    pingDatabase().catch(() => false),
    pingRedis().catch(() => false),
  ]);

  return {
    status: database && redis ? 'ok' : 'degraded',
    checks: { database, redis },
  };
}
