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

Out of order: the Stripe refund for Emma Larsen's payment is processed before the payment succeeded event, so the late succeeded event is marked ignored as stale.

Failed events: three Acme Stripe events carry a payload that fails validation, so they sit in `needs_attention` with a dead job and a recorded failed attempt.

Queued jobs: two Acme Stripe events are ingested but not yet processed, so the jobs stay queued and the events stay pending.

Guided demo case: Maya Patel (`maya.patel@example.com`) has a succeeded Stripe payment and an active subscription on `price_demo_pro`, but no entitlement row.
Reconciliation can find this missing entitlement.

Expired subscription with live access: Noah Kim's Stripe subscription is expired while his `pro` entitlement is still active.
