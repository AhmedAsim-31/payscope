# Demo data

All demo data is fictional and labeled.
Orgs are named "(demo)", connections are simulation-mode with "(demo)" in the name, and customer `external_ref` values start with `demo:`.
Customer emails use `example.com`.

## Demo users

The four users exist in Supabase Auth and are keyed by the same ids in `profiles`.
The shared password is not stored in this repo.
It is the `DEMO_USER_PASSWORD` value in the owner's `.env.local`.

| User                      | Acme Streaming (demo) | Globex Apps (demo) |
| ------------------------- | --------------------- | ------------------ |
| demo-owner@example.com    | OWNER                 | OWNER              |
| demo-operator@example.com | OPERATOR              | none               |
| demo-viewer@example.com   | VIEWER                | none               |
| demo-outsider@example.com | none                  | OWNER              |

The outsider exists for cross-tenant checks.
They must never see Acme data, and the owner switching orgs must never see rows from the other org.

## Seed and reset

Run migrations first, then seed.
`CREDENTIALS_ENCRYPTION_KEY` is required to encrypt the fictional webhook secrets (`openssl rand -base64 32`).

```bash
DATABASE_URL=postgresql://localhost:5432/payscope CREDENTIALS_ENCRYPTION_KEY=<base64> pnpm db:seed
DATABASE_URL=postgresql://localhost:5432/payscope CREDENTIALS_ENCRYPTION_KEY=<base64> pnpm db:reset-demo
```

`pnpm demo:reset` does both in one step: it runs the seed guard first, then migrations, then the reset.
A walkthrough of the seeded data is in [demo-script.md](demo-script.md).

Seeding is deterministic and idempotent.
Ids are UUID v5 values derived from stable names, and re-running converges on the same rows.
`db:reset-demo` deletes only the two demo orgs (cascading) and seeds them again.
Other orgs are never touched.

The seed refuses to run when `NODE_ENV=production`.
It also refuses any `DATABASE_URL` host other than `localhost` or `127.0.0.1` unless `SEED_ALLOW_REMOTE=true`.

Events are built from the adapter fixtures and written through the same ingest function the webhook route uses.
Each event is then processed by the real `process_provider_event` handler, so payments, subscriptions, customers, and entitlements come from real processing.
Event timestamps are spread over the 30 days before today (UTC).

## Volumes

The seed creates about 40 customers, about 128 payments in USD, EUR, GBP, and JPY, about 31 subscriptions in mixed states, and entitlements.
Acme has Stripe, Paddle, and RevenueCat connections.
Globex has PayPal and Stripe connections.
The Acme Stripe connection maps `price_demo_pro` to the `pro` entitlement.

## Deliberate situations

Duplicate delivery: one Stripe payment event for Ava Chen is delivered twice, and the second delivery is deduplicated into a single event row.

Out of order: an older Stripe payment succeeded event for Emma Larsen's payment is redelivered after its full refund, so it is marked ignored as stale and the payment stays refunded.

Failed events: three Acme Stripe events carry a payload that fails validation, so they sit in `needs_attention` with a dead job and a recorded failed attempt.

Queued jobs: two Acme Stripe events are ingested but not yet processed, so the jobs stay queued and the events stay pending.

Guided demo case: Maya Patel (`maya.patel@example.com`) has a succeeded Stripe payment and an active subscription on `price_demo_pro`, but no entitlement row.
Reconciliation can find this missing entitlement.

Expired subscription with live access: Noah Kim's Stripe subscription is expired while his `pro` entitlement is still active.

## Scenario lab

The Scenario lab page (`/app/<orgId>/scenarios`) runs 17 repeatable scenarios against the real pipeline.
Each run is a `run_scenario` job: it ingests events, runs the worker and reconciliation, and calls the real HTTP routes for the signature and cross-tenant cases.
All scenarios are local simulations (no live provider calls).
The provider API failure and mismatch scenarios use a fake provider fetch that exists only inside the lab.

Isolation: every org gets one `Scenario lab (demo)` simulation connection.
Provider ids, customers and events are suffixed with the run id, so repeats never collide and seed data is never touched.
The lab only runs jobs it creates (the worker is told which job ids to claim).

Reset deletes only the lab connection, its events, jobs, records, runs, lab customers and the run history for the org.
Running needs the `scenarios:run` permission (OWNER, ADMIN, OPERATOR) and is limited by the `scenarioRun` rate limit policy.
Runs and resets are audited as `scenario.run` and `scenario.reset`.

The catalog lives in code (`packages/shared/src/scenario-schemas.ts`) rather than a table.
It is static, versioned with the implementations, and shared by the API and web without a seed step.
Only runs are stored, in `demo_scenario_runs`.

| #   | Scenario                                     | Simulates                                                                      | Expected outcome                                                                            | Evidence                                        |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Successful payment                           | A provider reports a succeeded payment through a signed webhook.               | Event processed and a succeeded payment record exists.                                      | event, job, payment                             |
| 2   | Failed payment                               | A provider reports a payment that failed.                                      | Event processed and the payment record is failed.                                           | event, job, payment                             |
| 3   | Subscription lifecycle transition            | A subscription is created, goes past due, then ends.                           | Subscription ends expired and the granted entitlement is no longer active.                  | events, jobs, subscription, entitlement         |
| 4   | Refund                                       | A succeeded payment is later fully refunded.                                   | Payment is refunded with the full amount recorded as refunded.                              | events, jobs, payment                           |
| 5   | Duplicate webhook                            | The same signed webhook is delivered twice over HTTP.                          | Second delivery is acknowledged as duplicate; one event and one payment exist.              | event, job, payment, HTTP responses             |
| 6   | Out-of-order webhook                         | A refund event arrives before the payment event it refers to.                  | Early refund waits for its payment event; the payment keeps its real amount, ends refunded. | events, jobs, payment                           |
| 7   | Provider API failure                         | The provider API is unreachable during a provider-mode reconciliation run.     | Run finishes partial with a low-severity provider_unavailable finding, not a crash.         | run, finding, payment                           |
| 8   | Processing failure                           | A verified event carries a malformed payload the processor cannot apply.       | Event needs attention, the job is dead, and the failed attempt is recorded.                 | event, job                                      |
| 9   | Successful payment with inactive entitlement | A customer paid and has an active subscription but no entitlement was granted. | Local reconciliation raises an entitlement_missing_or_stale finding.                        | events, payment, subscription, run, finding     |
| 10  | Expired subscription with active entitlement | A subscription ended but its entitlement was never revoked.                    | Local reconciliation raises an expired_externally_active_locally finding.                   | events, subscription, entitlement, run, finding |
| 11  | Invalid signature                            | A webhook arrives signed with the wrong secret.                                | HTTP 400 WEBHOOK_SIGNATURE_INVALID and no event is stored.                                  | HTTP response                                   |
| 12  | Cross-tenant access attempt                  | A member of this organization requests another organization by id.             | HTTP 404 on every attempt, with no hint that the other organization exists.                 | HTTP responses                                  |
| 13  | Retry exhaustion and dead letter             | The provider stays unavailable for every processing attempt.                   | Three attempts fail, the job is dead and the event needs attention.                         | event, job                                      |
| 14  | Reconciliation mismatch                      | The provider reports a different payment status than the local record.         | Provider-mode run raises a status_mismatch finding for the payment.                         | run, finding, payment                           |
| 15  | Recovery after simulated failure             | The provider is down for the first attempt and recovers before the retry.      | First attempt fails, the retry succeeds and the payment is recorded.                        | event, job, payment                             |
| 16  | Concurrent duplicate processing              | Two workers process two jobs for the same event at the same moment.            | The event is applied exactly once: one payment, one successful attempt.                     | event, jobs, payment                            |
| 17  | Worker crash and expired lease recovery      | A worker claims a job and dies before finishing it.                            | The lease expires, recovery requeues the job and a different worker completes it.           | event, job, payment, worker ids                 |
