# CLAUDE.md

Guidance for Claude Code when working in the PronounceAll repository.

## Documentation retrieval policy

PronounceAll has large specification documents. Conserve context aggressively.

Never read an entire SRS, SDD, Handoff, or Decisions document unless the task explicitly requires a whole-document audit.

Start with `DOC_INDEX.md` at the repository root.

For documentation-dependent work:

1. Identify the feature/domain involved.
2. Search for relevant requirement IDs, decision IDs, headings, table names, and terminology.
3. Read only the relevant sections and limited surrounding context.
4. Follow cross-references only when they materially affect the task.
5. Do not load unrelated sections into context.
6. Prefer several targeted searches/reads over one full-file read.
7. Before implementing, state which requirements/decisions are governing the change.
8. If two current sources conflict, stop and report the conflict rather than selecting one silently.

Source precedence and document roles are defined in `DOC_INDEX.md`.
