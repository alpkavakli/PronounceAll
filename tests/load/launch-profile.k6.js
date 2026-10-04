/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The pre-launch load test (NFR-PERF-08, NFR-PERF-04), for k6.
 *
 * For DURATION (10 minutes by default):
 *   - 200 anonymous visitors, each reading 5 word pages a minute: the page and
 *     its hydration read, as a browser with JavaScript does;
 *   - 20 signed-in users, each signing in and running one practice session to
 *     its end, then reading word pages like everyone else.
 * SCALE multiplies both counts (1 = the launch profile; a fraction for a smoke
 * run).
 *
 * Thresholds, which fail the run: error rate under 0.5 %; p95 time to first
 * byte within 400 ms for word pages and other origin responses (NFR-PERF-04,
 * uncached at the origin). Origin CPU and memory (under 70 %) are watched on
 * the host while this runs (`docker stats`): k6 cannot see them.
 *
 * Before: `node scripts/load-test-users.js --create` with LOAD_TEST_PASSWORD,
 * and, on staging, Turnstile's always-pass test keys for the duration. After:
 * `node scripts/load-test-users.js --remove`.
 *
 * Run (one command):
 *   docker run --rm -i --network host -e BASE_URL -e LOAD_TEST_PASSWORD \
 *     grafana/k6:1.3.0 run - < tests/load/launch-profile.k6.js
 */

import { check, fail, sleep } from 'k6';
import { randomBytes } from 'k6/crypto';
import http from 'k6/http';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const SCALE = Number(__ENV.SCALE || 1);
const DURATION = __ENV.DURATION || '10m';
const PASSWORD = __ENV.LOAD_TEST_PASSWORD;
const TURNSTILE = __ENV.TURNSTILE_TOKEN || 'load-test';
const PAGE_INTERVAL_S = 12; // 5 word pages a minute

export const options = {
  scenarios: {
    anonymous: { executor: 'constant-vus', vus: Math.max(1, Math.round(200 * SCALE)), duration: DURATION, exec: 'anonymous' },
    practice: { executor: 'constant-vus', vus: Math.max(1, Math.round(20 * SCALE)), duration: DURATION, exec: 'practice' },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    'http_req_waiting{page:word}': ['p(95)<400'],
    'http_req_waiting{page:hydration}': ['p(95)<400'],
    'http_req_waiting{page:practice}': ['p(95)<400'],
    checks: ['rate>0.995'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

/** Every word page, from the sitemap, so the load spreads across the dictionary. */
export function setup() {
  const sitemap = http.get(`${BASE}/sitemap.xml`);
  if (sitemap.status !== 200) fail(`sitemap: ${sitemap.status}`);
  const words = [...sitemap.body.matchAll(/<loc>[^<]*?(\/en-us\/[^<]+)<\/loc>/g)]
    .map((match) => match[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
    .filter((path) => !path.endsWith('/learnIPA'));
  if (words.length === 0) fail('no word pages in the sitemap');
  if (!PASSWORD) fail('set LOAD_TEST_PASSWORD (the one used by scripts/load-test-users.js)');
  return { words };
}

/** A uniform float in [0, 1) from k6's CSPRNG; the project bans Math.random everywhere (NFR-SEC-12). */
const random = () => new Uint32Array(randomBytes(4))[0] / 2 ** 32;
const pick = (list) => list[Math.floor(random() * list.length)];
const field = (html, name) => html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];

/** One word page and its hydration read. */
function readWord(words) {
  const page = http.get(`${BASE}${pick(words)}`, { tags: { page: 'word' } });
  check(page, { 'word page 200': (r) => r.status === 200 });
  const wordId = page.body?.match(/data-target-id="(\d+)"/)?.[1];
  if (wordId) {
    const hydration = http.get(`${BASE}/viewer-state?variant=en-us&words=${wordId}`, { tags: { page: 'hydration' } });
    check(hydration, { 'hydration 200': (r) => r.status === 200 });
  }
}

/**
 * Think time between pages: uniform over 0.5x-1.5x the interval, so the mean
 * stays at 5 pages a minute but visitors do not arrive in lockstep; the first
 * iteration also starts at a random offset. Fixed sleeps would send every
 * visitor at the same instant, a burst real traffic never has.
 */
const think = () => sleep(PAGE_INTERVAL_S * (0.5 + random()));

export function anonymous({ words }) {
  if (__ITER === 0) sleep(PAGE_INTERVAL_S * random());
  readWord(words);
  think();
}

/** Sign in once per virtual user, practise one session to its end, then read like everyone else. */
export function practice({ words }) {
  if (__ITER === 0) {
    sleep(PAGE_INTERVAL_S * random());
    const username = `loadtest${String(((__VU - 1) % 20) + 1).padStart(2, '0')}`;
    const form = http.get(`${BASE}/login`, { tags: { page: 'practice' } });
    const signedIn = http.post(
      `${BASE}/login`,
      { identifier: username, password: PASSWORD, 'cf-turnstile-response': TURNSTILE, _csrf: field(form.body, '_csrf') },
      { tags: { page: 'practice' }, headers: { Origin: BASE }, redirects: 0 },
    );
    if (!check(signedIn, { 'signed in': (r) => r.status === 303 })) fail(`sign-in of ${username}: ${signedIn.status}`);

    let turn = http.get(`${BASE}/practice`, { tags: { page: 'practice' } });
    for (let step = 0; step < 50 && turn.body?.includes('name="turnSeq"'); step += 1) {
      sleep(2 + random() * 3); // listening and answering
      turn = http.post(
        `${BASE}/practice/attempt`,
        {
          _csrf: field(turn.body, '_csrf'),
          sessionId: field(turn.body, 'sessionId'),
          turnSeq: field(turn.body, 'turnSeq'),
          rating: random() < 0.8 ? 'right' : 'wrong',
        },
        { tags: { page: 'practice' }, headers: { Origin: BASE } },
      );
      check(turn, { 'attempt accepted': (r) => r.status === 200 });
    }
    check(turn, { 'session completed': (r) => /Session complete|Nothing is due|nothing due/i.test(r.body ?? '') });
  }
  readWord(words);
  think();
}
