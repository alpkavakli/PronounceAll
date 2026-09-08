/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Small HTTP helpers shared by the middleware layer.
 */

/**
 * Run `listener` immediately before the response headers are flushed, while
 * they can still be modified.
 *
 * Needed because two rules in the design depend on the response class, and the
 * class is chosen by the route rather than known at middleware entry: the
 * caching posture of SDD v1.1 §6.3, and the FR-AUTH-01 rule that the `pa_uid`
 * cookie is never set on the cacheable word-page shell.
 *
 * @param {import('http').ServerResponse} res
 * @param {() => void} listener
 */
export function onHeaders(res, listener) {
  const originalWriteHead = res.writeHead;
  let fired = false;

  res.writeHead = function patchedWriteHead(...args) {
    if (!fired) {
      fired = true;
      listener();
    }
    return originalWriteHead.apply(this, args);
  };
}
