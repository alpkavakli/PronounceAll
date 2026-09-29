/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Playback speed and listen reporting for every audio path on a page
 * (FR-IPA-11, FR-SAVE-09; Frontend Design Baseline §10).
 *
 * Speed: exactly `1×` and `0.75×`, one choice for the whole page, held in
 * memory only and never persisted. It applies to server audio through
 * `playbackRate` (pitch preserved) and to Web Speech through the utterance rate.
 *
 * Listens: an event means playback ACTUALLY STARTED. Server audio reports on the
 * media element's `playing` event, and only for a start from the beginning — a
 * resume after pausing mid-clip is not a new listen, a failed load never fires
 * `playing`, and a replay from the start is a new one. Web Speech reports on the
 * utterance's `start` event. Whether anything is sent at all is decided by
 * hydration (`recordsHistory`): a passive visitor sends nothing.
 */

import { sendListen } from './viewer-state.js';

export const RATES = Object.freeze([1, 0.75]);

let rate = 1;
/** @type {Set<HTMLElement>} every speed toggle on the page, kept in step */
const toggles = new Set();
/** @type {Set<HTMLMediaElement>} */
const media = new Set();

/** @returns {number} the page's current playback rate */
export function currentRate() {
  return rate;
}

/** @param {HTMLMediaElement} element */
function applyRate(element) {
  element.playbackRate = rate;
  element.preservesPitch = true;
}

/** @param {number} next */
function setRate(next) {
  if (!RATES.includes(next)) return;
  rate = next;
  for (const element of media) applyRate(element);
  for (const group of toggles) {
    for (const button of group.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === rate));
    }
  }
}

/**
 * A `1× | 0.75×` button pair (baseline §10). All toggles on a page share one
 * selection.
 *
 * @returns {HTMLElement}
 */
export function createSpeedToggle() {
  const group = document.createElement('span');
  group.className = 'speed-toggle';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Playback speed');
  for (const value of RATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'speed-toggle__option';
    button.dataset.rate = String(value);
    button.textContent = `${value}×`;
    button.setAttribute('aria-pressed', String(value === rate));
    button.addEventListener('click', () => setRate(value));
    group.append(button);
  }
  toggles.add(group);
  return group;
}

/**
 * Apply the page rate to a media element and report its genuine starts.
 *
 * @param {HTMLMediaElement} element
 * @param {() => ({ kind: 'word'|'phoneme', id: string } | null)} target resolved at play time
 */
export function trackMedia(element, target) {
  if (media.has(element)) return;
  media.add(element);
  applyRate(element);

  let armed = false;
  element.addEventListener('play', () => {
    // A resource change can reset the rate; re-apply before audio is heard.
    applyRate(element);
    armed = element.currentTime < 0.05;
  });
  const report = () => {
    if (!armed) return;
    armed = false;
    const resolved = target();
    if (resolved) sendListen(resolved.kind, resolved.id);
  };
  element.addEventListener('playing', report);
  // WebKit can play a restart that was requested while still buffering without
  // ever firing `playing`. Time advancing from the start is the same evidence
  // that playback began; a load that fails never advances.
  element.addEventListener('timeupdate', () => {
    if (!element.paused && element.currentTime > 0) report();
  });
  element.addEventListener('error', () => {
    armed = false;
  });
}

/**
 * Prepare a Web Speech utterance: the page rate, and a listen report when the
 * engine actually starts speaking (FR-SAVE-09).
 *
 * @param {SpeechSynthesisUtterance} utterance
 * @param {{ kind: 'word'|'phoneme', id: string } | null} target
 */
export function prepareUtterance(utterance, target) {
  utterance.rate = rate;
  if (target) utterance.addEventListener('start', () => sendListen(target.kind, target.id));
}

/** Server-rendered `<audio data-listen-kind>` elements and their toggles. */
function enhanceNativeAudio() {
  const elements = document.querySelectorAll('audio[data-listen-kind]');
  for (const element of elements) {
    trackMedia(element, () => ({ kind: element.dataset.listenKind, id: element.dataset.listenId }));
  }

  // Word page: a toggle beside each whole-word control, primary or tier 3.
  // Only where something can actually play: a server asset, or the tier-3
  // button in a browser that can speak.
  const canSpeak = Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === 'function';
  for (const block of document.querySelectorAll('.pronunciation__audio')) {
    if (block.querySelector('audio') || (canSpeak && block.querySelector('.pronunciation__speak'))) {
      block.append(createSpeedToggle());
    }
  }

  // IPA pages: one page-level toggle; rows follow it (baseline §10).
  const list = document.querySelector('.phoneme-list');
  if (list && elements.length > 0) {
    const bar = document.createElement('p');
    bar.className = 'speed-bar';
    bar.append(createSpeedToggle());
    list.before(bar);
  }
}

enhanceNativeAudio();
