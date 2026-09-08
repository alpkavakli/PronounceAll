-- PronounceAll — Copyright (C) 2026 Alp Kavaklı
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- See LICENSE-NOTICE.md at the repository root.
--
-- Reference data for `language_variants` (FR-CONTENT-06, E1).
--
-- American English is the only variant seeded and the only one active in v1.0
-- (Charter §5, Handoff "Key Decisions Already Locked"). The URL pattern
-- /:variant/:word resolves `en-us` against this row.

INSERT INTO language_variants (code, display_name, is_active)
VALUES ('en-us', 'American English', TRUE);
