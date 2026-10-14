# API

Derived from the route files in `packages/api/src`.
Request and response schemas live in `packages/shared/src/*-schemas.ts` and are enforced with Zod on both sides.
`GET /openapi.json` serves an OpenAPI 3 document generated from those Zod schemas.

## Conventions

Base path is `/api/v1` for user-facing routes.
Bodies are JSON; a `GET` with a body is rejected with `400 BAD_REQUEST`, and JSON nested deeper than 20 levels is rejected.
Every response carries `x-request-id`; a UUID sent in that header is reused, anything else is replaced.
Record, event, run, finding, incident, and audit lists use keyset pagination: `?cursor=<opaque>&limit=<n>` (default 25, capped at 100), and the response is `{ items, nextCursor }` with `nextCursor` null on the last page.
Money fields are integer minor units serialized as digit strings, for example `amountMinor: "1999"` with `currency: "USD"`.

## Auth

User routes need `Authorization: Bearer <Supabase access token>`.
The API verifies the JWT signature against the Supabase project JWKS, with issuer `<SUPABASE_URL>/auth/v1` and audience `authenticated`.
A missing, malformed, or invalid token answers `401` with `www-authenticate: Bearer`; an unreachable key set answers `503 AUTH_UNAVAILABLE`.

Org routes resolve the caller's membership for `:orgId`.
Not a member, or a malformed id, answers `404 NOT_FOUND`; a member without the permission answers `403 FORBIDDEN`.

| Permission                                                                                                       | Roles                  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| read permissions                                                                                                 | all roles              |
| `jobs:retry`, `reconciliation:run`, `findings:update`, `repairs:execute`, `scenarios:run`, `entitlements:ingest` | OWNER, ADMIN, OPERATOR |
| `records:export`                                                                                                 | OWNER, ADMIN, OPERATOR |
| `members:manage`, `connections:manage`, `org:update`                                                             | OWNER, ADMIN           |
| `org:delete`, `ownership:transfer`                                                                               | OWNER                  |

Webhooks authenticate by provider signature, and `/internal/tick` by the `x-internal-token` header.

## Error shape

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "/limit", "message": "..." }],
    "requestId": "8f1c..."
  }
}
```

`details` is present only when useful.
Server errors answer `500 INTERNAL_ERROR` with a generic message; internals are only logged.
Unknown routes answer `404 NOT_FOUND`.
Rate-limited requests answer `429 RATE_LIMITED` with `retry-after` and `x-ratelimit-*` headers.

## Routes

`{org}` stands for `/api/v1/orgs/:orgId`.

### Health and identity

| Method | Path           | Permission    | Notes                           |
| ------ | -------------- | ------------- | ------------------------------- |
| GET    | `/health`      | none          | Liveness                        |
| GET    | `/ready`       | none          | Database check, `503` if down   |
| GET    | `/api/v1/me`   | authenticated | Current user                    |
| GET    | `/api/v1/orgs` | authenticated | Orgs the caller belongs to      |
| POST   | `/api/v1/orgs` | authenticated | Creates an org, caller is OWNER |
| GET    | `{org}`        | `org:read`    |                                 |

### Members

| Method | Path                                       | Permission                | Notes                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `{org}/members`                            | `members:read`            |                                                                                                                                                                                                                                                                                   |
| POST   | `{org}/members`                            | `members:manage`          |                                                                                                                                                                                                                                                                                   |
| PATCH  | `{org}/members/:userId`                    | `members:manage`          | Role change; only an owner can grant or change OWNER, and the last owner cannot be demoted                                                                                                                                                                                        |
| DELETE | `{org}/members/:userId`                    | `members:manage`, or self | Leaving the org needs only `org:read`                                                                                                                                                                                                                                             |
| POST   | `{org}/members/:userId/transfer-ownership` | `ownership:transfer`      | Target becomes OWNER and the caller becomes ADMIN in one audited transaction (`ownership.transfer`). `422 SELF_TRANSFER` for the caller, `404` for a non-member, `409 ALREADY_OWNER` if the target is an owner, `409 OWNERSHIP_CHANGED` if the caller lost ownership concurrently |

### Provider connections

| Method | Path                                                      | Permission           | Notes                                                                                                                                  |
| ------ | --------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `{org}/connections`                                       | `connections:manage` | Mode `sandbox` or `simulation`; only sandbox API keys accepted                                                                         |
| GET    | `{org}/connections`                                       | `connections:read`   | Returns `hasWebhookSecret` and `hasApiKey`, never secrets                                                                              |
| GET    | `{org}/connections/:connectionId`                         | `connections:read`   |                                                                                                                                        |
| PATCH  | `{org}/connections/:connectionId`                         | `connections:manage` | Rotate webhook secret or API key, set `entitlementMap`                                                                                 |
| POST   | `{org}/connections/:connectionId/verify`                  | `connections:manage` | Calls the provider with the stored API key; sets `status`, `lastVerifiedAt`, `lastError`. `409 SIMULATED_CONNECTION`, `422 NO_API_KEY` |
| DELETE | `{org}/connections/:connectionId/credentials/:credential` | `connections:manage` | `:credential` is `webhookSecret` or `apiKey`. Returns the connection view; audited as `connection.credential_remove`                   |

Removing `webhookSecret` drops every stored webhook secret, and removing `apiKey` drops the API key.
Removing the API key of a sandbox connection that is not `disabled` sets its `status` back to `unverified`.
Removing a credential that is not stored answers `200` and changes nothing.

### Records

All need `records:read`.

| Method | Path                                                         |
| ------ | ------------------------------------------------------------ |
| GET    | `{org}/overview`                                             |
| GET    | `{org}/payments`, `{org}/payments/:paymentId`                |
| GET    | `{org}/subscriptions`, `{org}/subscriptions/:subscriptionId` |
| GET    | `{org}/customers`, `{org}/customers/:customerId`             |
| GET    | `{org}/entitlements`, `{org}/entitlements/:entitlementId`    |

Payment list filters: `status`, `provider`, `currency`, `connectionId`, `customerId`, and `subscriptionId` match exactly.
`subscriptionId` matches payments on the same connection whose provider subscription id is that subscription's.
`minAmount` and `maxAmount` are inclusive bounds on `amountMinor`, as digit strings; `minAmount` above `maxAmount` answers `422 INVALID_AMOUNT_RANGE`.
`from` (inclusive) and `to` (exclusive) are ISO 8601 timestamps on `createdAt`.

Subscription list items and detail include `canceledAt` and `endedAt` (ISO 8601 or `null`) as the provider reported them.
Stripe supplies both, Paddle supplies `canceledAt`, RevenueCat supplies `endedAt` on expiration, and PayPal supplies neither.

Customer list `q` matches a case-insensitive email prefix (wildcards are literal) or an exact provider customer id from the org's provider customer mappings.

### Entitlement ingestion

| Method | Path                 | Permission            | Notes                                                     |
| ------ | -------------------- | --------------------- | --------------------------------------------------------- |
| POST   | `{org}/entitlements` | `entitlements:ingest` | Upserts one entitlement snapshot; needs `Idempotency-Key` |

This is how an application reports entitlement state that PayScope cannot see in its own provider events.
The body is `{ customerId, entitlementKey, state, observedAt, subscriptionId?, grantedAt?, expiresAt?, revokedAt? }`, where `state` is `active`, `expired`, or `revoked` and `customerId` must belong to the org.
Rows are keyed by customer and entitlement key, and an ingested row has `source: "ingestion_api"`.
The body is a full snapshot: `expiresAt` and `revokedAt` are replaced, `grantedAt` defaults to `observedAt` on first grant, and `revokedAt` defaults to `observedAt` for `revoked`.
`observedAt` orders writes against each other and against provider events: a snapshot older than the row's last update answers `200` with `applied: false` and the current row.
An `observedAt` more than five minutes in the future answers `422 OBSERVED_AT_IN_FUTURE`, and an unknown customer or subscription answers `404 NOT_FOUND`.
Each applied or ignored write is audited as `entitlement.ingest`; reusing a key with a different body answers `422 IDEMPOTENCY_KEY_REUSED`.

### Events and jobs

| Method | Path                          | Permission    | Notes                                             |
| ------ | ----------------------------- | ------------- | ------------------------------------------------- |
| GET    | `{org}/events`                | `events:read` | Event inbox                                       |
| GET    | `{org}/events/:eventId`       | `events:read` | Redacted payload, attempts, job                   |
| GET    | `{org}/jobs/summary`          | `events:read` | Job counts by status, plus `retrying`             |
| POST   | `{org}/events/:eventId/retry` | `jobs:retry`  | Sets the event back to `pending` and re-queues it |

The jobs summary `retrying` count is the queued jobs that already used at least one attempt.
The worker never sets job status `failed`, so `counts.failed` stays 0.

Event list filters: `status`, `provider`, `connectionId`, `normalizedType`, and `objectRef` (the provider object id) match exactly, and `from` and `to` bound the timestamp.
`customerId` matches events whose object is a payment, subscription, or provider customer mapping of that customer on the same connection.

Event detail adds `signatureVerified`, `objectRef`, and `related: { paymentId, subscriptionId, customerId }`.
Each related id is resolved from `objectRef` within the event's org and connection only, and is `null` when nothing matches.
A payment event also resolves the payment's subscription and customer, and a subscription event its customer.

Each attempt carries `correlationId` and `nextRetryAt`.
`correlationId` is a UUID the worker generates per job run, and it matches the `correlationId` on that run's `job_finished` log line.
`nextRetryAt` is the time the queue made the job available again after a retryable failure, and `null` when no retry was scheduled.

### Reconciliation

| Method | Path                                                       | Permission           | Notes                                            |
| ------ | ---------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| POST   | `{org}/reconciliation/runs`                                | `reconciliation:run` | `{ connectionId?, mode }`; `409 RUN_IN_PROGRESS` |
| GET    | `{org}/reconciliation/runs`, `.../runs/:runId`             | `records:read`       |                                                  |
| GET    | `{org}/reconciliation/findings`, `.../findings/:findingId` | `records:read`       |                                                  |
| PATCH  | `{org}/reconciliation/findings/:findingId`                 | `findings:update`    | Status `reviewed` or `dismissed` only            |

Finding list filters: `type`, `status`, `severity`, `subjectType`, and `subjectId` match exactly.
`runId` matches findings the run first detected or last saw.

Each run carries `trigger`: `manual` for runs started through this API, `scheduled` for runs the internal tick starts (see [operations.md](operations.md#scheduled-reconciliation)).

### CSV export

| Method | Path                                   | Permission       |
| ------ | -------------------------------------- | ---------------- |
| GET    | `{org}/payments/export`                | `records:export` |
| GET    | `{org}/reconciliation/findings/export` | `records:export` |

Each takes the same filters as its list endpoint, without `cursor` and `limit`, and answers `text/csv` as an attachment, newest first.
Exports are capped at 5,000 rows; `x-export-truncated: true` means more rows matched, so narrow the filters.
Amounts are integer minor units (`amount_minor`, `amount_refunded_minor`) next to a `currency` column, never decimals.
Cells that start with `=`, `+`, `-`, `@`, tab, or carriage return are prefixed with `'` so spreadsheets do not evaluate them.
VIEWER can read lists but cannot export, because an export moves bulk tenant data off the console.
Exports are reads and are not written to the audit log; the audit log covers mutations.

### Incidents

| Method | Path                                             | Permission        | Notes                               |
| ------ | ------------------------------------------------ | ----------------- | ----------------------------------- |
| GET    | `{org}/incidents`, `{org}/incidents/:incidentId` | `records:read`    |                                     |
| POST   | `{org}/incidents/:incidentId/actions`            | `findings:update` | `acknowledge`, `note`, or `resolve` |

Incident list filters: `status`, `severity`, and `category` match exactly.
`severity` takes a finding severity and `category` takes a finding type, because each incident groups the findings of one type.

### Repairs

All need `repairs:execute`, an `Idempotency-Key` header, and a `reason` of 10 to 500 characters.
None of them write to a provider.

| Method | Path                                  |
| ------ | ------------------------------------- |
| POST   | `{org}/repairs/reprocess-event`       |
| POST   | `{org}/repairs/correct-entitlement`   |
| POST   | `{org}/repairs/resolve-finding`       |
| POST   | `{org}/repairs/refresh-from-provider` |

`refresh-from-provider` takes `{ paymentId, reason }` or `{ subscriptionId, reason }`, never both.
It reads the object from the provider and overwrites the local status (and, for a payment, amount and currency).
When the result matches the provider, open or reviewed `status_mismatch` findings on that record are resolved and their ids are returned in `resultingState.resolvedFindingIds`.
This also happens when the record already matches: the request still answers `409 ALREADY_CONSISTENT`, and the resolved ids are in `error.details.resolvedFindingIds`.
A subscription refresh re-derives its entitlements from the connection's plan map, the same way webhook ingestion does; when that changes them, `resultingState.entitlements` holds the new `state` and `keys`.
Errors: `404 NOT_FOUND`, `409 CONNECTION_NOT_VERIFIED`, `409 PROVIDER_NOT_CONFIGURED`, `422 PROVIDER_FETCH_UNSUPPORTED` when the adapter cannot fetch that kind (RevenueCat payments), `409 PROVIDER_OBJECT_NOT_FOUND`, `502 PROVIDER_UNAVAILABLE`, `502 PROVIDER_FETCH_FAILED`, `422 PROVIDER_STATUS_UNMAPPED`, `409 ALREADY_CONSISTENT`, `409 REFUND_EXCEEDS_AMOUNT`, and `409 CONCURRENT_UPDATE` when the record changed while the provider was being read.

Reusing a key with a different body answers `422 IDEMPOTENCY_KEY_REUSED`; see [architecture.md](architecture.md#repair-center).

### Scenario lab and audit

| Method | Path                              | Permission      | Notes                   |
| ------ | --------------------------------- | --------------- | ----------------------- |
| GET    | `{org}/scenarios`                 | `records:read`  | Catalog and latest runs |
| POST   | `{org}/scenarios/:scenarioId/run` | `scenarios:run` | Local simulation        |
| POST   | `{org}/scenarios/reset`           | `scenarios:run` | Deletes only lab data   |
| GET    | `{org}/scenario-runs/:runId`      | `records:read`  |                         |
| GET    | `{org}/audit`                     | `audit:read`    | Append-only log         |

Audit list filters: `action`, `actor` (user id), `targetType`, `targetId` match exactly.
`customerId` matches rows that target that customer or one of its payments, subscriptions, or entitlements.
`from` (inclusive) and `to` (exclusive) are ISO 8601 timestamps on `createdAt`; `from` after `to` answers `400 VALIDATION_ERROR`.
`q` is trimmed free text (1 to 200 characters) matched case-insensitively as a substring of action, target type, target id, actor id, actor type, and reason; `%` and `_` match literally.
All filters combine with AND and keep keyset pagination, so pass the same filters alongside `cursor`.

### Machine routes

| Method | Path                                | Auth               | Notes                                                                                                         |
| ------ | ----------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| POST   | `/webhooks/:provider/:connectionId` | Provider signature | `stripe`, `paypal`, `paddle`, `revenuecat`; 256 KiB limit                                                     |
| POST   | `/internal/tick`                    | `x-internal-token` | Registered only when `INTERNAL_TICK_TOKEN` is set; also schedules reconciliation runs and prunes expired data |

The connections, reconciliation, and webhook routes are registered only when `CREDENTIALS_ENCRYPTION_KEY` is set.

## Rate limits

Counters are stored in Postgres (`rate_limit_buckets`), so they hold across restarts and instances.

| Applied to                                            | Policy                                               | Default                            |
| ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| Every authenticated route                             | `authenticatedRead` / `authenticatedWrite` by method | 300 and 60 per minute per user     |
| Connection create, update, verify, credential removal | `credentialTest`, in addition                        | 5 per minute per user and org      |
| Reconciliation run start                              | `reconciliationRun`, in addition                     | 5 per 10 minutes per org           |
| Scenario run and reset                                | `scenarioRun`, in addition                           | 20 per 10 minutes per org          |
| Repair actions                                        | `repairAction`, in addition                          | 30 per 10 minutes per user and org |
| List, search, and CSV export routes                   | `search`, in addition                                | 60 per minute per user             |
| Webhooks                                              | `webhookIngress`                                     | 600 per minute per connection      |
| `/internal/tick`                                      | `internalTick`                                       | 30 per minute per IP               |

Authenticated routes are `/api/v1/me` and every org route: orgs, members, connections, records, events, reconciliation, incidents, repairs, scenarios, audit, and overview.
Each policy can be overridden with `RATE_LIMIT_<POLICY>_MAX` and `RATE_LIMIT_<POLICY>_WINDOW_SEC`, for example `RATE_LIMIT_WEBHOOK_INGRESS_MAX`.
