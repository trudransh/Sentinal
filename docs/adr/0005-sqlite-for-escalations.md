# ADR 0005 — SQLite (better-sqlite3) for escalation queue + rate-limit log

| | |
|---|---|
| Status | Accepted |
| Date | 2026-04-28 |
| Driver | Phase 3 (rate-limiter), Phase 5 (escalations) |

## Context

The signer-shim needs a sliding-window spend log. The dashboard needs an
escalations table with operator-resolvable state. Both are relatively
small (per-agent rows, low write rate, queries by recency).

## Decision

Use **`better-sqlite3` ^11** with WAL mode, file-backed. One table for spend
log, two tables for the dashboard (`policy_events`, `escalations`). For tests,
the same module exports `createInMemoryRateLimiter` against `:memory:` so
unit tests don't pollute the file system.

Path: `app/.data/sentinel.db` for the dashboard, `process.env.SENTINEL_RATE_LIMIT_DB`
or auto-generated path under `.data/` for the signer-shim.

## Consequences

**Positive**
- Single binary dependency, no daemon, no setup
- Synchronous API — eliminates a class of "did the write commit before
  the next check?" races that async drivers introduce
- WAL mode handles the concurrent read (dashboard SSE) + write (webhook
  ingest) pattern without contention
- Tests are real-database tests (not mocks) using `:memory:` — `D1-D10`
  bug sweep validated this trade-off after we got burned by mocked tests
  in past projects (see `docs/learnings.md`)

**Negative**
- File-bound — multi-process deployments (e.g. Next.js serverless) need
  external storage. Postgres would be a one-line driver swap if we hit that.
- No replication — a corrupted DB file means lost history. For a
  hackathon submission this is acceptable; production deployments should
  upgrade to Postgres or back the file with snapshots.
- The Next.js `app/lib/db.ts` opens the file at module load and caches a
  handle, which works for single-process `next dev` but doesn't scale to
  `next start` with multiple workers. Documented as a known limit.

## Alternatives rejected

- **Postgres**: more correct, more setup. Single dependency outweighs
  hypothetical-future-scale gains for a 13-day build.
- **In-memory only**: loses escalation state on restart, which is the worst
  possible UX for an approval queue.
- **DynamoDB / Supabase**: extra hosted dependency, extra secret in `.env`,
  no marginal value over local SQLite for the hackathon.

## Verification

`packages/signer-shim/src/rate-limiter.ts` + `rate-limiter.test.ts` (4 fixtures
including window-boundary and prune-on-startup, the latter added in D3).
`app/lib/db.ts` + the live webhook ingest (verified 2026-04-28). Migration
to Postgres post-hackathon is a one-day port (driver + connection pool;
SQL stays).
