/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Learned-phoneme presentation, `/learnIPA` progress, and the progress banner
 * (FR-IPA-02, FR-IPA-07, FR-IPA-10, FR-WORD-06; Frontend Design Baseline §8.1,
 * §11).
 *
 * A projection of the FR-SAVE state, nothing more: `learned` is learned; every
 * other state is not yet learned. Until hydration reports a state, the page
 * keeps its default presentation and asserts neither.
 *
 * State is applied by `data-phoneme-id` / `data-learner-phoneme`. This module
 * never reads or parses an IPA string.
 */

import { loadViewerState } from './viewer-state.js';

/** @type {Record<string, string>} phoneme id to FR-SAVE state */
const phonemeStates = {};
let learned = 0;
let total = 0;

const isLearned = (id) => phonemeStates[id] === 'learned';

/** @param {string} id */
function applyToPhoneme(id) {
  const learnedNow = isLearned(id);

  for (const element of document.querySelectorAll(`.phoneme[data-phoneme-id="${CSS.escape(id)}"]`)) {
    element.classList.toggle('phoneme--learned', learnedNow);
    element.classList.toggle('phoneme--not-learned', !learnedNow);
    const symbol = element.dataset.symbol ?? '';
    element.setAttribute('aria-label', `phoneme /${symbol}/, ${learnedNow ? 'learned' : 'not learned yet'}`);
  }

  for (const element of document.querySelectorAll(`[data-learner-phoneme="${CSS.escape(id)}"]`)) {
    element.classList.toggle('phoneme--learned', learnedNow);
    element.classList.toggle('phoneme--not-learned', !learnedNow);
    const status = element.querySelector('[data-learner-status]');
    if (status) status.textContent = learnedNow ? ', learned' : ', not learned yet';
  }
}

function renderCounts() {
  const banner = document.querySelector('[data-ipa-banner] a');
  if (banner) {
    // The shell's invitation is FR-WORD-06's zero-learned text; keep it to
    // restore if the last learned phoneme is untagged.
    banner.dataset.invitation ??= banner.textContent;
    banner.textContent =
      learned > 0 ? `${learned}/${total} — doing great! ${total - learned} to go` : banner.dataset.invitation;
  }

  const progress = document.querySelector('[data-learn-progress]');
  if (progress) {
    progress.textContent = `${learned} / ${total} learned`;
    progress.hidden = false;
  }
}

/** The all / learned / not-yet-learned filter on the IPA pages (JavaScript only). */
function installFilter() {
  const list = document.querySelector('.phoneme-list');
  const progress = document.querySelector('[data-learn-progress]');
  if (!list || !progress) return;

  const group = document.createElement('div');
  group.className = 'learn-filter';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Show');

  const options = [
    { value: 'all', label: 'All' },
    { value: 'learned', label: 'Learned' },
    { value: 'not-learned', label: 'Not learned yet' },
  ];
  let current = 'all';

  const apply = () => {
    for (const row of list.querySelectorAll('[data-row-phoneme]')) {
      const learnedRow = isLearned(row.getAttribute('data-row-phoneme'));
      row.hidden = current === 'learned' ? !learnedRow : current === 'not-learned' ? learnedRow : false;
    }
    for (const button of group.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === current));
    }
  };

  for (const { value, label } of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'learn-filter__option';
    button.dataset.filter = value;
    button.textContent = label;
    button.addEventListener('click', () => {
      current = value;
      apply();
    });
    group.append(button);
  }

  progress.after(group);
  apply();
  document.addEventListener('pa:save-state', apply);
}

async function init() {
  const state = await loadViewerState();
  if (!state) return;

  Object.assign(phonemeStates, state.phonemes);
  learned = state.learned;
  total = state.total;

  for (const id of Object.keys(phonemeStates)) applyToPhoneme(id);
  renderCounts();

  // A tag change in the popover or on a row updates every view of that phoneme,
  // and the counts move with it. Registered before the filter's listener, so
  // the filter re-applies against the updated state.
  document.addEventListener('pa:save-state', (event) => {
    const { kind, id, state: next } = event.detail;
    if (kind !== 'phoneme') return;
    const wasLearned = isLearned(id);
    phonemeStates[id] = next;
    learned += Number(isLearned(id)) - Number(wasLearned);
    applyToPhoneme(id);
    renderCounts();
  });

  installFilter();
}

init();
