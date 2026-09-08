# PronounceAll

A free, open-source pronunciation reference and practice tool for English
learners. Look up a word, see its IPA transcription with every phoneme
clickable, hear it, save it, and practise it on a spaced-repetition schedule.

PronounceAll has no profit motive: no revenue targets, no ad-network contracts,
no engagement metrics. The source is public so that claim can be verified
rather than trusted.

> **Status: Iteration 0 — Foundation.** The specification is complete and the
> application skeleton is in place. User-facing features begin at Iteration 1.

## Licensing

| What | Licence |
|---|---|
| **Code** | [GNU AGPL-3.0](LICENSE) — any modified version operated as a network service must publish its modifications |
| **Content** — IPA example-word lists, documentation, original recordings | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| **Dictionary data ingested from upstream sources** | Retains upstream licensing, documented per source and displayed on every word page |

See [LICENSE-NOTICE.md](LICENSE-NOTICE.md) for the source-file header
convention. `LICENSE` is the FSF text verbatim.

## Requirements

- Node.js 22 or later
- Docker and Docker Compose (for MySQL 8, Redis, and Flyway)

## Getting started

```bash
git clone https://github.com/alpkavakli/PronounceAll.git
cd PronounceAll
npm install

cp .env.example .env      # fill in local development values
docker compose up -d mysql redis
npm run migrate           # Flyway applies migrations/
npm run dev
```

The application is then at <http://localhost:3000>, with a liveness report at
`/health` that reports `degraded` while MySQL or Redis is unreachable.

To run the whole stack in containers instead:

```bash
docker compose up --build
```

## Development

```bash
npm run lint           # ESLint, including the architecture and SQL rules
npm run lint:licence   # NFR-LEGAL-03 licence-header check
npm test               # unit + integration (Jest, Supertest)
npm run test:e2e       # end-to-end (Playwright)
```

`npm run lint` is not a style pass. It enforces two properties the architecture
depends on, so they are checked by the build rather than remembered by a
reviewer:

- **The dependency direction.** `routes → services → repositories`. A route
  importing a repository, a repository importing a service, or a business
  service importing the database pool fails the lint.
- **SQL parameterisation.** Interpolated or concatenated SQL in a `query()` or
  `execute()` call fails the lint. All SQL is raw, parameterised, and confined
  to the repository layer.

## Architecture

A server-rendered EJS application on Node and Express. MySQL 8 is the system of
record, reached through raw parameterised SQL with no ORM; Redis carries
sessions, rate-limit counters, the idempotency store, and BullMQ queues. Pages
are readable without JavaScript and progressively enhanced.

```
src/
  routes/        HTTP routing, thin request and response handling
  services/      domain and business logic, independent of Express
  repositories/  all database access and raw SQL
  middleware/    sessions, CSRF, rate limiting, logging, error handling
  validators/    request and input validation
  errors/        AppError and the stable error codes
  config/        environment loading and validation
  lib/           shared infrastructure clients and utilities
  views/         EJS templates and partials
  public/        browser JavaScript, CSS, and static assets
  workers/       standalone BullMQ worker entry points
  jobs/          reusable job definitions and handlers
migrations/      versioned Flyway SQL migrations
scripts/         operational, import, seed, and reconciliation utilities
tests/           unit, integration, and end-to-end tests
```

## Documentation

Specification and design documents live under `docs/`. Start at
[DOC_INDEX.md](DOC_INDEX.md), which routes a task to the exact documents and
IDs it needs. In short: `docs/current/` holds the requirements and design
baselines, `docs/process/` the live process documents, `docs/archive/`
superseded drafts with no authority, and `docs/references/` external material.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributors are expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, follow
[SECURITY.md](SECURITY.md) rather than opening a public issue.
