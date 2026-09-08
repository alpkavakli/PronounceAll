## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- The reason, not the mechanics. Link the issue: Closes #123 -->

## Governing requirements

<!-- The requirement or decision IDs this implements, e.g. FR-WORD-04, E3, C5.
     Write "none — maintenance" if this is a fix, chore, or docs change. -->

## How it was verified

<!-- The commands you ran and what they showed. If something could not be
     verified locally, say what and why rather than leaving it unsaid. -->

- [ ] `npm run lint`
- [ ] `npm run lint:licence`
- [ ] `npm test`
- [ ] `npm run test:e2e` (if the change is user-facing)

## Checklist

- [ ] Tests cover the new behaviour, including the failure and edge cases
- [ ] No migration that has already been applied was edited
- [ ] No secret, credential, or personal data appears in the diff or in a log
- [ ] All SQL is parameterised and lives in a repository
- [ ] The diff is limited to this change — no unrelated refactoring or reformatting
- [ ] Reading still works with JavaScript disabled (user-facing changes)
- [ ] Specification documents under `docs/current/` are unchanged
