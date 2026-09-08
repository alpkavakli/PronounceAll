# Contributing to PronounceAll

Thank you for considering a contribution. PronounceAll is maintained by one
person, so a little structure keeps things moving.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

**Open an issue first for anything beyond a small fix.** PronounceAll is built
from a written specification, and a change that contradicts it will be turned
down however good the code is. An issue costs you five minutes and can save you
an afternoon.

Typos, broken links, failing tests, and obvious bugs need no prior discussion —
send the pull request.

**Do not report a vulnerability as an issue.** Follow [SECURITY.md](SECURITY.md).

## Setting up

```bash
npm install
cp .env.example .env
docker compose up -d mysql redis
npm run migrate
npm run dev
```

## The rules the build enforces

These are checked by `npm run lint`, not by review, so you will find out
immediately:

- **Dependency direction:** `routes → services → repositories`. Routes parse,
  validate, call one service, and render. Services hold the domain logic and do
  not import Express or a database client. Repositories own all SQL.
- **Parameterised SQL only.** No user-controlled value is ever interpolated or
  concatenated into a statement.
- **No `Math.random`** for anything. Use `src/lib/ids.js`.
- **A licence header** on every `.js`, `.mjs`, `.cjs`, and `.ejs` file.

A few more that review does check:

- Log through the shared logger in `src/lib/logger.js`, never `console`, and
  never log a raw request body on an authentication or save route.
- Escape output in EJS with `<%= %>`; `<%- %>` is for static or explicitly
  sanitised content only.
- Never edit a migration that has already been applied — Flyway's checksum will
  reject it. Write a new one.
- Markup is semantic and meets WCAG 2.2 AA. Reading a word page must work with
  JavaScript disabled.

## Making a change

1. Branch from `main`.
2. Write the change and the tests together. A requirement's acceptance criteria
   are the first source of its tests, and the interesting cases are usually the
   invariants — transaction atomicity, idempotency, authorization failure,
   concurrent duplicates — not the happy path.
3. Run the gate locally:

   ```bash
   npm run lint && npm run lint:licence && npm test
   ```

4. Keep the diff narrow. Unrelated refactoring, reformatting, and renaming make
   a change harder to review and harder to revert.
5. Open a pull request against `main` and fill in the template.

Continuous integration runs on every push and every pull request, and merge is
blocked until every job passes.

## Commit messages

Write a short imperative subject line, and use the body to explain *why* where
the reason is not obvious. Reference the issue or the requirement ID
(`FR-WORD-04`, `NFR-SEC-07`) when there is one — the specification is the
project's memory.

## Licensing your contribution

Contributions are accepted under the same licences as the project: AGPL-3.0 for
code, CC BY-SA 4.0 for content. By opening a pull request you confirm you have
the right to contribute the work under those terms.

## Working on the specification

`docs/current/` holds the requirements and design baselines. Do not change them
in a code pull request. If implementation shows a requirement to be wrong or
unbuildable, say so in an issue — that is a genuinely useful contribution, and
it gets decided before the code changes, not after.
