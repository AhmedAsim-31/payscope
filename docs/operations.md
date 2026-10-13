# Operations

## Running the worker

The API starts the job worker in-process by default.
Set `RUN_WORKER_IN_PROCESS=false` to disable that and run the worker as a separate process.
In development run `pnpm --filter @payscope/api worker`.
After a build run `node packages/api/dist/worker-main.js` with `DATABASE_URL` and the other required environment variables set.
Both entrypoints stop gracefully on SIGINT and SIGTERM: they stop claiming, wait up to 10 seconds for in-flight jobs, then close the pool.
A job that outlives the wait keeps its lease and is recovered after the lease expires.

## Draining the queue with a tick

Set `INTERNAL_TICK_TOKEN` (at least 16 characters) on the API to enable the endpoint.
Call it from a scheduler or keep-alive when the host sleeps between requests.

```bash
curl -X POST "$API_URL/internal/tick" -H "x-internal-token: $INTERNAL_TICK_TOKEN"
```

The response is `{"claimed": <jobs run>, "recovered": <expired leases re-queued>}`.
One tick runs at most one concurrency-sized batch, so call it again while `claimed` is not zero.
A missing or wrong token returns 401.

## Dead jobs

A job with status `dead` will not be retried automatically.
It reached `dead` because its handler threw a non-retryable error, it used all `max_attempts`, its lease expired on the last attempt, or its kind has no handler.
`last_error` holds a sanitized message (at most 1000 characters); the payload is never logged.
Inspect them with:

```sql
select id, kind, attempt_count, last_error, updated_at
from background_jobs where status = 'dead' order by updated_at desc;
```

After fixing the cause, re-queue one by setting `status = 'queued'`, `attempt_count = 0`, and `available_at = now()`.
For `process_provider_event`, the matching event row shows `failed` or `needs_attention`, and `event_processing_attempts` lists each attempt with its failure category.

## End-to-end tests

The Playwright suite in `packages/e2e` drives the real web app, API, worker, local Postgres and Supabase Auth.
It covers sign in and out, org switching and cross-tenant access, payment investigation, event retry, reconciliation and repair, the scenario lab, viewer restrictions, and a smoke pass over every page at 1280 and 375 pixels wide.

Run it locally:

```bash
pnpm --filter @payscope/e2e exec playwright install chromium   # once
pnpm e2e                                                       # or pnpm e2e:headed
```

Needs:

- `DEMO_USER_PASSWORD` and the usual API and web variables in the repo-root `.env.local`; the specs skip with a message when the password is missing.
- A local Postgres at `DATABASE_URL` (the seed refuses remote hosts).
- Playwright starts the API (`:3001`) and web (`:3000`) unless they are already running.

Every run starts with `db:reset-demo`, so the specs are deterministic against the seed.
Never point it at a database you care about.
Traces are kept on the first retry in `packages/e2e/test-results`; `playwright-report` and `.auth` (signed-in session files) are gitignored.

E2E is not part of CI or `pnpm test`.
Running it in GitHub Actions needs the repo owner to add `DEMO_USER_PASSWORD` plus the Supabase URL and publishable key as secrets, and a job with a Postgres service that runs migrations before `pnpm e2e`.
