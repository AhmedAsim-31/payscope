# Backend performance and abuse protection

## Rate limiting

Every limit is per endpoint class; there is no single global limit.
Limits are enforced by `@fastify/rate-limit` (registered with `global: false`) using a Postgres-backed store.
Each policy is a named entry in `packages/api/src/rate-limit/policies.ts` with a default, a key scope, and an env override.
Routes opt in with `app.rateLimitFor('<policy>')`, or `app.rateLimitByMethod()` for the authenticated read/write pair.

### Policies

| Policy               | Default    | Key              | Status       |
| -------------------- | ---------- | ---------------- | ------------ |
| `authenticatedRead`  | 300 / 60 s | user id          | wired        |
| `authenticatedWrite` | 60 / 60 s  | user id          | wired        |
| `credentialTest`     | 5 / 60 s   | user id + org id | wired        |
| `webhookIngress`     | 600 / 60 s | connection id    | wired        |
| `internalTick`       | 30 / 60 s  | client IP        | wired        |
| `reconciliationRun`  | 5 / 600 s  | org id           | wired        |
| `scenarioRun`        | 20 / 600 s | org id           | wired        |
| `repairAction`       | 30 / 600 s | user id + org id | wired        |
| `search`             | 60 / 60 s  | user id          | defined only |

Every authenticated route (`/me`, orgs, members, connections, records, events, reconciliation, incidents, repairs, scenarios, audit, overview) gets `authenticatedRead` or `authenticatedWrite` by method.
`credentialTest` is applied to connection create and credential rotation, in addition to `authenticatedWrite`.
`reconciliationRun` is applied to starting a reconciliation run, `scenarioRun` to scenario run and reset, and `repairAction` to every repair action, each in addition to `authenticatedWrite`.
`search` is defined only; no search route exists yet.
A policy whose identity is missing at check time (for example no org on the request) falls back to the client IP instead of skipping the limit.

### Configuration

Override any policy with `RATE_LIMIT_<NAME>_MAX` and `RATE_LIMIT_<NAME>_WINDOW_SEC`, where `<NAME>` is the policy name in upper snake case.
Example: `RATE_LIMIT_CREDENTIAL_TEST_MAX=10`.
Values are validated at startup as positive integers (window at most 86400 seconds), and an invalid value fails boot naming the variable.

### Exceeded requests

The response is `429` with `{ "error": { "code": "RATE_LIMITED", "message": "...", "requestId": "..." } }`.
The `Retry-After` header carries the seconds until the bucket resets, alongside `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

### Store design

The store is the `rate_limit_buckets` table (`key`, `count`, `reset_at`), shared by every API and worker process.
Each hit is one atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement.
An expired bucket is reset to 1 inside the same statement, so concurrent requests can never both observe a stale window.
Time comes from the database clock, so instances with skewed clocks agree.
The table has row level security enabled with no policies, so it is invisible to tenant (`authenticated`) roles.
Expired buckets are deleted opportunistically, at most once a minute per process, in batches of 1000 rows that have been expired for over an hour.

### Fail-open rationale

If the store query fails, the request is allowed and a `rate_limit_store_failed_open` warning is logged.
A limiter outage must not take down the API, and webhook ingress in particular must keep accepting provider deliveries.
The cost is a temporary loss of abuse protection while the database is unreachable; in that state most routes fail on their own database access anyway.

### Trusted proxy rules

The client IP used for IP-keyed policies is `request.ip`, which Fastify derives from the socket address.
`X-Forwarded-For` is honoured only when `TRUST_PROXY=true`; with `TRUST_PROXY=false` (the default) a spoofed header cannot change the bucket.
Set `TRUST_PROXY=true` only when the API sits behind a proxy that overwrites `X-Forwarded-For`, otherwise clients can mint unlimited buckets.
IPv6 addresses are normalised to their /64 prefix so a client cannot rotate addresses within its subnet.
Authenticated policies never use the IP; they key on the verified token subject and, where relevant, the organization resolved from membership.

## Overview queries

`GET /api/v1/orgs/:orgId/overview` runs seven independent statements in parallel: payments grouped by currency and status, subscriptions by status, entitlements by state, events in range by status, open findings by severity, the existing jobs summary, and the latest 10 events.
Each is one `GROUP BY` over rows of a single org, so the response cost is bounded by the number of distinct groups, not the number of rows returned.
Sums are computed in Postgres and returned as text, then added as `BigInt` per currency in the API, so amounts above 2^53 stay exact and currencies are never summed together.

The result is cached in process for 15 seconds per org and range, and concurrent requests for the same key share one in-flight load.
A failed load is evicted so the next request retries.
The response carries `Cache-Control: private, no-store` so browsers and shared caches never keep it; only the API process cache does.

### Plans on the seeded dev database

Largest seeded org: 82 payments in range, 132 events in range, 17 entitlements.

| Query                         | Plan                                                         | Execution |
| ----------------------------- | ------------------------------------------------------------ | --------- |
| Payments by currency, 30 days | Seq Scan, HashAggregate, Sort (16 groups, 7 buffers)         | 0.21 ms   |
| Events by status, 30 days     | Seq Scan, HashAggregate (35 buffers)                         | 0.40 ms   |
| Open findings by severity     | Index Scan on `reconciliation_findings_open_fingerprint_idx` | 0.05 ms   |
| Entitlements by state         | Seq Scan, HashAggregate (1 buffer)                           | 0.09 ms   |

The sequential scans are the planner's correct choice at this size: each table fits in a few pages, so an index lookup would cost more than reading them.
At production volume the filters match existing indexes: `payment_records_org_created_idx (org_id, created_at desc)` and `provider_events_org_received_idx (org_id, received_at desc)` bound the range scans, and `*_org_status_idx` covers the status counts.
No index was added, because no plan on this data shows a cost an index would remove.
Revisit if a single org grows past roughly a million payments in the 90 day range; the next step would be a covering index on `(org_id, created_at) INCLUDE (currency, status, amount_minor, amount_refunded_minor)`.
