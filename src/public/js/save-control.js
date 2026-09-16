/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The unified save control for words and phonemes (FR-SAVE-01, FR-SAVE-02,
 * FR-SAVE-06; Frontend Design Baseline §14).
 *
 * Server-rendered, the control is a link to the no-JavaScript confirmation page
 * (FR-SAVE-07). Here it is upgraded to a real button once hydration reports the
 * viewer's state:
 *
 *   unsaved  → activation saves;
 *   saved, learning, learned → activation opens the tag choice
 *              (None · Learning · Learned · Remove).
 *
 * With cookies refused, the control is disabled with an explanation and records
 * nothing (FR-SAVE-06).
 */

import { cookiesAvailable, loadViewerState, sendSaveAction } from './viewer-state.js';

const LABELS = { unsaved: 'Save', saved: 'Saved', learning: 'Learning', learned: 'Learned' };
const TAGS = [
  { tag: 'none', label: 'None' },
  { tag: 'learning', label: 'Learning' },
  { tag: 'learned', label: 'Learned' },
];

/** @type {Map<string, Set<HTMLButtonElement>>} every control per `kind:id`, kept in step */
const controls = new Map();
/** @type {Record<string, string>} */
const states = {};

/** @type {HTMLElement | null} */
let menu = null;
/** @type {HTMLButtonElement | null} */
let menuFor = null;

const keyOf = (kind, id) => `${kind}:${id}`;

/** @param {HTMLButtonElement} button @param {string} state */
function render(button, state) {
  const name = button.dataset.targetLabel ?? '';
  button.dataset.state = state;
  button.textContent = LABELS[state];
  button.setAttribute('aria-pressed', String(state !== 'unsaved'));
  button.setAttribute(
    'aria-label',
    state === 'unsaved' ? `Save ${name}` : `${LABELS[state]}: ${name}. Change or remove`,
  );
}

/** @param {string} kind @param {string} id @param {string} state */
function setState(kind, id, state) {
  states[keyOf(kind, id)] = state;
  for (const button of controls.get(keyOf(kind, id)) ?? []) render(button, state);
  document.dispatchEvent(new CustomEvent('pa:save-state', { detail: { kind, id, state } }));
}

function closeMenu() {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  menuFor?.setAttribute('aria-expanded', 'false');
  menuFor = null;
}

/** @param {HTMLButtonElement} button */
async function change(button, action, tag) {
  const { targetKind: kind, targetId: id } = button.dataset;
  button.disabled = true;
  try {
    setState(kind, id, await sendSaveAction({ targetKind: kind, targetId: id, action, tag }));
  } catch {
    button.setAttribute('title', 'That change could not be saved. Please try again.');
  } finally {
    button.disabled = false;
  }
}

/** @returns {HTMLElement} */
function ensureMenu() {
  if (menu) return menu;
  menu = document.createElement('div');
  menu.className = 'save-menu';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Tag');
  menu.hidden = true;
  for (const { tag, label } of TAGS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'save-menu__option';
    option.dataset.tag = tag;
    option.textContent = label;
    menu.append(option);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'save-menu__option save-menu__remove';
  remove.dataset.tag = 'remove';
  remove.textContent = 'Remove';
  menu.append(remove);

  menu.addEventListener('click', (event) => {
    const option = event.target.closest?.('.save-menu__option');
    if (!option || !menuFor) return;
    const target = menuFor;
    closeMenu();
    target.focus();
    if (option.dataset.tag === 'remove') change(target, 'unsave');
    else change(target, 'tag', option.dataset.tag);
  });
  document.body.append(menu);
  return menu;
}

/** @param {HTMLButtonElement} button */
function openMenu(button) {
  const element = ensureMenu();
  const current = button.dataset.state;
  for (const option of element.querySelectorAll('[data-tag]')) {
    const tag = option.dataset.tag;
    const selected = (tag === 'none' && current === 'saved') || tag === current;
    if (tag !== 'remove') option.setAttribute('aria-pressed', String(selected));
  }
  const box = button.getBoundingClientRect();
  element.hidden = false;
  element.style.top = `${box.bottom + window.scrollY + 4}px`;
  element.style.left = `${Math.max(8, box.left + window.scrollX)}px`;
  button.setAttribute('aria-expanded', 'true');
  menuFor = button;
  element.querySelector('[aria-pressed="true"], [data-tag]')?.focus();
}

/**
 * Build a save control for a target. Used for server-rendered links and for
 * controls created at runtime, such as the phoneme popover's.
 *
 * @param {{ kind: string, id: string, label: string }} target
 * @returns {HTMLButtonElement}
 */
export function createSaveControl({ kind, id, label }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'save-control';
  button.dataset.saveControl = '';
  button.dataset.targetKind = kind;
  button.dataset.targetId = id;
  button.dataset.targetLabel = label;
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');

  const key = keyOf(kind, id);
  if (!controls.has(key)) controls.set(key, new Set());
  controls.get(key).add(button);
  render(button, states[key] ?? 'unsaved');

  if (!cookiesAvailable()) {
    button.disabled = true;
    button.textContent = 'Save';
    button.setAttribute('aria-label', 'Enable cookies to save your progress.');
    button.title = 'Enable cookies to save your progress.';
    return button;
  }

  button.addEventListener('click', () => {
    if (menuFor === button) {
      closeMenu();
      return;
    }
    closeMenu();
    if (button.dataset.state === 'unsaved') change(button, 'save');
    else openMenu(button);
  });
  return button;
}

/** @returns {string|undefined} a phoneme or word state already hydrated */
export function knownState(kind, id) {
  return states[keyOf(kind, id)];
}

async function enhance() {
  const links = [...document.querySelectorAll('a[data-save-control]')];
  const state = await loadViewerState();
  if (!state) return;

  for (const [id, value] of Object.entries(state.words)) states[keyOf('word', id)] = value;
  for (const [id, value] of Object.entries(state.phonemes)) states[keyOf('phoneme', id)] = value;

  for (const link of links) {
    link.replaceWith(
      createSaveControl({
        kind: link.dataset.targetKind,
        id: link.dataset.targetId,
        label: link.dataset.targetLabel ?? '',
      }),
    );
  }
  document.dispatchEvent(new CustomEvent('pa:viewer-state', { detail: state }));

  document.addEventListener('click', (event) => {
    if (menu && !menu.hidden && !event.target.closest?.('.save-menu, .save-control')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuFor) {
      const previous = menuFor;
      closeMenu();
      previous.focus();
    }
  });
}

enhance();
