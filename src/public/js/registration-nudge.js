/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The registration nudge (FR-AUTH-17, Foundational Decisions §6, NFR-A11Y-04).
 *
 * Shown once the hydration read says a signed-out visitor has 5 or more saved
 * items, until dismissed. Dismissal is kept in localStorage under
 * `pa_register_nudge_dismissed`, so it does not return on this browser. It is
 * never shown to anyone signed in (the server never sets the flag for them).
 *
 * A non-modal notice: it sits in the page's normal tab order, takes no focus on
 * appearing and traps none (NFR-A11Y-04). It exists only with JavaScript, like
 * the localStorage it depends on; the cached page never carries it.
 */

import { loadViewerState } from './viewer-state.js';

const DISMISSED_KEY = 'pa_register_nudge_dismissed';

function isDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable: the nudge goes for this page and may return later.
  }
}

function render() {
  const nudge = document.createElement('aside');
  nudge.className = 'register-nudge';
  nudge.setAttribute('aria-label', 'Create an account');

  const message = document.createElement('p');
  message.className = 'register-nudge__message';
  message.textContent = 'Create an account so you never lose your progress.';

  const actions = document.createElement('p');
  actions.className = 'register-nudge__actions';
  const create = document.createElement('a');
  create.className = 'button';
  create.href = '/register';
  create.textContent = 'Create an account';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'button button--secondary';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    rememberDismissal();
    nudge.remove();
  });
  actions.append(create, dismiss);

  nudge.append(message, actions);
  // First in the main content: reachable early in the tab order, never over it.
  const main = document.querySelector('main');
  main?.prepend(nudge);
}

async function start() {
  if (isDismissed()) return;
  const state = await loadViewerState();
  if (state?.registrationNudge === true && !isDismissed()) render();
}

start();
