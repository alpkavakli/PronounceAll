/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The phoneme popover (FR-IPA-02, FR-IPA-03, FR-IPA-04, NFR-A11Y-08).
 *
 * A progressive enhancement, layered over markup that already reads correctly
 * without it: each phoneme is a real `<button>` rendered server-side, so with
 * JavaScript disabled the transcription is still complete, legible text and the
 * buttons are simply inert (FR-WORD-08).
 *
 * **This file performs no linguistic parsing of IPA.** It reads
 * `data-phoneme-id` and the display data the server already resolved. That is a
 * root `CLAUDE.md` invariant: tokenisation belongs to the seed pipeline, which
 * did it once, server-side, into `pronunciation_phonemes`.
 *
 * The popover is a single shared element moved between buttons rather than one
 * node per phoneme: a transcription can hold a dozen occurrences, and a dozen
 * hidden dialogs per pronunciation would cost markup for nothing.
 */

const POPOVER_ID = 'phoneme-popover';

/** @type {HTMLElement | null} */
let popover = null;
/** @type {HTMLButtonElement | null} */
let openFor = null;
/** @type {HTMLAudioElement | null} */
let player = null;

/** @returns {HTMLElement} the lazily built popover element */
function ensurePopover() {
  if (popover) {
    return popover;
  }

  popover = document.createElement('div');
  popover.id = POPOVER_ID;
  popover.className = 'phoneme-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Phoneme detail');
  popover.hidden = true;

  const symbol = document.createElement('p');
  symbol.className = 'phoneme-popover__symbol';
  symbol.lang = 'und-fonipa';

  const example = document.createElement('p');
  example.className = 'phoneme-popover__example';

  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'phoneme-popover__replay';
  replay.textContent = 'Play sound';
  replay.addEventListener('click', () => {
    if (openFor) {
      play(openFor.dataset.audio);
    }
  });

  popover.append(symbol, example, replay);
  document.body.append(popover);
  return popover;
}

/**
 * @param {string | undefined} source
 */
function play(source) {
  if (!source) {
    return;
  }
  // One reused element: FR-IPA-04 wants click-to-audible latency low, and
  // recreating an <audio> per press re-runs resource selection every time.
  player ??= new Audio();
  if (player.src !== new URL(source, document.baseURI).href) {
    player.src = source;
  }
  player.currentTime = 0;
  // A rejected play() is normal — autoplay policy, or a missing file — and must
  // not surface as an unhandled rejection.
  player.play().catch(() => {});
}

/** @param {HTMLButtonElement} button */
function open(button) {
  const element = ensurePopover();
  const symbol = button.dataset.symbol ?? button.textContent ?? '';
  const exampleWord = button.dataset.exampleWord;
  const exampleIpa = button.dataset.exampleIpa;
  const audio = button.dataset.audio;

  element.querySelector('.phoneme-popover__symbol').textContent = symbol;

  const example = element.querySelector('.phoneme-popover__example');
  example.textContent = exampleWord
    ? `as in ${exampleWord}${exampleIpa ? ` /${exampleIpa}/` : ''}`
    : '';
  example.hidden = !exampleWord;

  // FR-IPA-03 lists replay among the popover's contents, but a control with no
  // asset behind it cannot replay anything. It is hidden rather than disabled,
  // on the same rule the server applies to whole-word audio.
  const replay = element.querySelector('.phoneme-popover__replay');
  replay.hidden = !audio;

  const box = button.getBoundingClientRect();
  element.hidden = false;
  // Positioned after unhiding, so the measured height is the real one.
  const height = element.offsetHeight;
  const top = box.top + window.scrollY - height - 8;
  element.style.top = `${top < window.scrollY ? box.bottom + window.scrollY + 8 : top}px`;
  element.style.left = `${Math.max(8, box.left + window.scrollX + box.width / 2 - element.offsetWidth / 2)}px`;

  button.setAttribute('aria-expanded', 'true');
  openFor = button;

  play(audio);
}

function close() {
  if (!popover || popover.hidden) {
    return;
  }
  popover.hidden = true;
  if (openFor) {
    openFor.setAttribute('aria-expanded', 'false');
    openFor = null;
  }
}

/** @param {MouseEvent} event */
function onDocumentClick(event) {
  const button = event.target.closest?.('.phoneme');
  if (button) {
    // A second press on the open phoneme closes it, so pointer users get the
    // same toggle keyboard users get from Escape.
    if (openFor === button) {
      close();
    } else {
      open(button);
    }
    return;
  }
  if (!event.target.closest?.(`#${POPOVER_ID}`)) {
    close();
  }
}

/** @param {KeyboardEvent} event */
function onKeydown(event) {
  if (event.key === 'Escape') {
    const previous = openFor;
    close();
    // Focus returns to the phoneme that opened it, or the dialog would strand
    // keyboard focus at the end of the document.
    previous?.focus();
  }
}

export function initPhonemePopovers() {
  const phonemes = document.querySelectorAll('.phoneme');
  if (phonemes.length === 0) {
    return;
  }

  for (const button of phonemes) {
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
  }

  // Delegated: one listener regardless of how many phonemes the page shows.
  // `<button>` already answers Enter and Space with a click event, so keyboard
  // activation needs no separate handler (NFR-A11Y-08).
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', close);
}

initPhonemePopovers();
