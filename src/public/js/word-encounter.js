/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Word encounter recording on the word page (FR-SAVE-10; SDD v1.1 §3.4).
 *
 * The cached shell is identical for every viewer and never writes; this module
 * sends the separate `POST /encounter` after hydration, and only for a viewer
 * whose history is already recorded. With JavaScript disabled nothing is sent,
 * as FR-SAVE-10 specifies. It reads one `data-*` attribute and nothing else.
 */

import { sendEncounter } from './viewer-state.js';

const wordId = document.querySelector('[data-encounter-word]')?.getAttribute('data-encounter-word');
if (wordId && /^[0-9]+$/.test(wordId)) {
  sendEncounter(wordId);
}
