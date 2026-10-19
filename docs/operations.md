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

The response is `{"claimed": <jobs run>, "recovered": <expired leases re-queued>, "scheduled": <reconciliation runs started>, "pruned": <rows pruned per table>}`.
One tick runs at most one concurrency-sized batch, so call it again while `claimed` is not zero.
A missing or wrong token returns 401.

## Scheduled reconciliation

Each tick starts a local reconciliation run for every org that has at least one `active` provider connection and no run, manual or scheduled, started within the last `RECONCILIATION_SCHEDULE_INTERVAL_HOURS` (default 24).
An org with a run still `running` is skipped.
Scheduled runs have `trigger = 'scheduled'` and no `triggered_by`; the runs page shows the trigger.
Concurrent ticks are serialized by a transaction-scoped advisory lock, so overlapping calls start at most one run per org.
Set `RECONCILIATION_SCHEDULE_INTERVAL_HOURS=0` to turn scheduling off.
Provider-mode runs are still started by hand.

## Data retention

Each tick also runs one retention pass, reported as `pruned` in the tick response.
The PRD asks for a policy but sets no periods, so these defaults are conservative choices:

| Data                     | Env var                            | Default   | Action                                                                                                                            |
| ------------------------ | ---------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Raw provider payloads    | `RETENTION_EVENT_PAYLOAD_DAYS`     | 30 days   | `processed`, `duplicate` and `ignored` events older than this get `payload = {}` and `payload_pruned_at` set; the event row stays |
| Finished background jobs | `RETENTION_FINISHED_JOB_DAYS`      | 30 days   | `succeeded`, `failed` and `dead` jobs not updated for this long are deleted; their attempts keep the event link and lose `job_id` |
| Idempotency records      | `RETENTION_IDEMPOTENCY_GRACE_DAYS` | 7 days    | Deleted this long after `expires_at`                                                                                              |
| Demo scenario runs       | `RETENTION_SCENARIO_RUN_DAYS`      | 30 days   | Finished runs started before this are deleted                                                                                     |
| Audit logs               | `RETENTION_AUDIT_LOG_DAYS`         | 2555 days | Rows older than about seven years are deleted                                                                                     |

Set any period to `0` to keep that data forever.
Payment, subscription, entitlement, reconciliation finding, reconciliation run and incident rows are never pruned.
Payloads of `pending`, `processing`, `failed` and `needs_attention` events are kept so they can still be processed or reprocessed.
Reprocessing an event whose payload was pruned returns 409 `PAYLOAD_PRUNED`.

Each pass handles at most 500 rows per table, oldest first, using a dedicated index, so a backlog drains over several ticks.
Batches select rows with `FOR UPDATE SKIP LOCKED`, so concurrent ticks prune disjoint rows.
Audit logs stay append-only: the trigger allows a delete only inside a transaction that sets `app.retention_prune = 'on'`, which the prune does and the `authenticated` role cannot use because it has no delete grant.

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

E2E is not part of `pnpm test`, but the `e2e` CI job runs it on pushes to master and on same-repo PRs (fork PRs have no secrets, so the job is skipped).
The job uses a Postgres service and the repo secrets `DEMO_USER_PASSWORD`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and uploads the Playwright report on failure.
