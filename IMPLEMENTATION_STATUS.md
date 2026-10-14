# Implementation Status

Last updated 2026-10-14.

## Current phase

Phase 9, Portfolio Packaging (PAYSCOPE-10), is in progress.
Phases 0 to 8 are merged to `master`.
The product runs end to end locally: web, API, in-process worker, local Postgres, and Supabase Auth.
Nothing is hosted yet; see "Known gaps and blockers".

## Real vs simulated

Real (runs the production code paths):

- Webhook ingress, signature verification, replay window, and exactly-once event storage.
- The Postgres job queue and worker: claims, leases, retries, lease recovery, and dead-lettering.
- Event processing into payments, subscriptions, customers, and entitlements, including subscription `canceled_at` and `ended_at` where the provider payload carries them.
- Processing attempts record a correlation id and, for retryable failures, the next retry time.
- Local-rule reconciliation, findings, incidents, repairs, and the audit log.
- Incidents recount on every finding status change (review, dismiss, resolve, correct entitlement, refresh from provider) and auto-resolve when no open or reviewed high or critical findings remain.
- The audit log shows the actor's email when the actor is a current member of the same org, and links targets to their detail pages.
- `/ready` fails with 503 when the in-process worker's heartbeat is stale (60 seconds with defaults), but only when `RUN_WORKER_IN_PROCESS=true`.
- Auth through Supabase Auth (JWKS), org roles, and Postgres RLS.
- Rate limiting, input validation, and encrypted per-connection credentials.
- CSV export of payments and findings, capped at 5,000 rows.

Simulated:

- Every seeded connection is in simulation mode and all seed data is fictional, labeled "(demo)" and `example.com`.
- Seed events are built from adapter fixtures, then run through the real ingest and processing code.
- Scenario lab runs are local simulations on a dedicated "Scenario lab (demo)" connection.
  The provider API failure and mismatch scenarios use a fake provider fetch that exists only inside the lab.

Not verified:

- The four provider adapters are written against official docs but never exercised against a live sandbox (capability `implemented_unverified`).
- Provider-mode reconciliation is covered only by the lab's fake fetch, because no sandbox API key is configured.
- Refresh from provider (including the entitlement recompute and the `ALREADY_CONSISTENT` finding resolution) is covered only by integration tests with a fake adapter.
  The demo connections have no credentials, so a refresh there answers `PROVIDER_NOT_CONFIGURED`.

## Capability matrix

| Capability                                                    | Status    | Notes                                                                |
| ------------------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| Webhook ingress with raw-body signature checks                | Real      | Stripe, PayPal, Paddle, RevenueCat                                   |
| Duplicate and out-of-order event handling                     | Real      | Unique constraints and guarded transitions                           |
| Job worker with retries, lease recovery, dead letter          | Real      | `FOR UPDATE SKIP LOCKED`                                             |
| Payments, subscriptions, customers, entitlements screens      | Real      | Keyset pagination; filter bar Apply commits every text field at once |
| Event inbox, attempts, safe retry                             | Real      | Attempts carry a correlation id and next retry time                  |
| Event detail related records and signature status             | Real      | Links to payment, subscription, customer in the same org and connection |
| Jobs summary                                                  | Real      | Queued, Running, Retrying, Dead, oldest queued                       |
| Customer search                                               | Real      | Email prefix or exact provider customer id                           |
| Subscription `canceled_at` and `ended_at`                     | Real      | Stripe both, Paddle canceled only, RevenueCat ended only, PayPal none |
| CSV export of payments and findings                           | Real      | `records:export` (OWNER, ADMIN, OPERATOR); 5,000-row cap             |
| Per-currency overview dashboard                               | Real      | SQL aggregates, integer minor units; Open incidents tile             |
| Local-rule reconciliation, findings, incidents                | Real      | Incident severity and category filters; incident-scoped findings link |
| Incident recount and auto-resolve on finding status change    | Real      | Same transaction; advisory lock per org and finding type             |
| Repair center and append-only audit log                       | Real      | Reasoned, idempotent repairs; actor email and target links           |
| Multi-tenant orgs, roles, RLS, cross-tenant tests             | Real      | OWNER, ADMIN, OPERATOR, VIEWER                                       |
| Rate limiting                                                 | Real      | Postgres-backed, per endpoint                                        |
| `/ready` worker liveness check                                | Real      | Only with `RUN_WORKER_IN_PROCESS=true`; 60s default threshold        |
| Credential encryption and key rotation                        | Real      | See [docs/security.md](docs/security.md)                             |
| Demo seed and one-command reset                               | Simulated | Fictional data, real processing; `pnpm demo:reset`                   |
| Scenario lab (17 scenarios)                                   | Simulated | Real pipeline, simulation connection, fake provider fetch where noted |
| Provider sandbox webhooks and API calls                       | Planned   | Needs sandbox credentials per provider                               |
| Provider-mode reconciliation against a real provider          | Planned   | Code exists; untested without a sandbox key                          |
| Refresh from provider with entitlement recompute              | Planned   | Code exists; fake-adapter tests only, no sandbox key                 |
| Hosted demo (Vercel web, Render API, Supabase DB)             | Blocked   | PAYSCOPE-45                                                          |
| Scheduled tick (pg_cron plus pg_net, GitHub Actions fallback) | Planned   | Config added; not applied, see docs/deployment.md                    |
| E2E in CI                                                     | Planned   | Needs `DEMO_USER_PASSWORD` and Supabase values as GitHub secrets     |

## Quality gates

- CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, migrations, unit and integration tests, and build on every PR.
- The Playwright suite (`pnpm e2e`) covers the primary investigation and recovery flows, plus a visual and axe sweep of every page in light and dark at 375, 768, and 1280 pixels.
  It runs locally only.

## Known gaps and blockers

- PAYSCOPE-45 (blocker): the Supabase database connection string and secret key are not available, so the Supabase Postgres has no migrations or data and there is no hosted environment.
- `render.yaml`, the opt-in pg_cron tick (`supabase/cron/tick.sql`), and the backup tick workflow are in the repo but not applied; the owner steps are in [docs/deployment.md](docs/deployment.md#owner-steps).
- The web project needs Vercel dashboard settings only; there is no `vercel.json`.
- No provider sandbox credentials are configured.
- The planned free hosts sleep and pause: Render Free after 15 minutes idle (about a minute to wake), Supabase Free after 7 days of low activity.
- Screenshots in `docs/screenshots/` come from `next dev`, so the Next.js dev indicator appears in the bottom-left corner.

## Next actions

1. Resolve PAYSCOPE-45, then migrate the Supabase database and stand up the hosted demo with the owner steps in [docs/deployment.md](docs/deployment.md#owner-steps).
2. Add provider sandbox credentials and verify the adapters end to end.
