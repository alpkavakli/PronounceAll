/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Whole-word audio, tier 3 of the FR-IPA-05 fallback chain.
 *
 * The chain is resolved server-side for tiers 1 and 2: a Wiktionary human
 * recording, then the pre-generated Piper asset. Either renders a native
 * `<audio controls>` element, which is also the FR-WORD-08 no-JavaScript path.
 * This module covers only the last resort — the visitor's own Web Speech API —
 * which is by definition client-side and reaches no project service (SDD §2:
 * the request path calls no TTS provider).
 *
 * The button is rendered hidden by the server and is unhidden here ONLY when
 * `speechSynthesis` actually exists, so a browser without it is never shown a
 * control that cannot speak. That is the same rule the server applies to a
 * pending asset.
 *
 * FR-IPA-05 also requires that a total failure is visible rather than silent,
 * so a refusal or an error surfaces in a live region next to the control.
 *
 * D-R3-08: this is offered for the PRIMARY pronunciation only. Synthesised
 * speech is one uncontrolled rendering and must never be presented as though it
 * were a specific secondary pronunciation, so the server emits the button on
 * the primary row alone and this module adds it to nothing.
 *
 * Progressive enhancement: with this file absent the page still reads, and any
 * word with a real asset still plays through its native control (§7.7).
 */

const UNAVAILABLE = 'Audio unavailable.';

/**
 * @param {HTMLElement | null} status
 * @param {string} message
 */
function announce(status, message) {
  if (!status) {
    return;
  }
  status.textContent = message;
  status.hidden = message === '';
}

/**
 * @param {HTMLButtonElement} button
 */
function speak(button) {
  const status = button.parentElement?.querySelector('.pronunciation__audio-status') ?? null;
  const text = button.dataset.speak;
  const synthesis = window.speechSynthesis;

  if (!text || !synthesis) {
    announce(status, UNAVAILABLE);
    return;
  }

  announce(status, '');

  let utterance;
  try {
    utterance = new SpeechSynthesisUtterance(text);
  } catch {
    announce(status, UNAVAILABLE);
    return;
  }

  if (button.dataset.lang) {
    utterance.lang = button.dataset.lang;
  }
  // A failure here is the end of the chain: there is no fourth tier, so the
  // visitor is told rather than left with a control that did nothing.
  utterance.addEventListener('error', () => announce(status, UNAVAILABLE));

  try {
    // Cancel first: a queued utterance from a previous press would otherwise
    // make the control feel unresponsive.
    synthesis.cancel();
    synthesis.speak(utterance);
  } catch {
    announce(status, UNAVAILABLE);
  }
}

export function enableWholeWordAudio(root = document) {
  // Feature-detect before revealing anything. Test for the VALUES, not for the
  // property names: `'speechSynthesis' in window` is still true when the
  // property exists holding `undefined`. A synthesiser that is present but
  // unusable is caught later by the error handler and reported.
  if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') {
    return;
  }

  for (const button of root.querySelectorAll('.pronunciation__speak[hidden]')) {
    button.hidden = false;
    button.addEventListener('click', () => speak(button));
  }
}

enableWholeWordAudio();
