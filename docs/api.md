# API

Derived from the route files in `packages/api/src`.
Request and response schemas live in `packages/shared/src/*-schemas.ts` and are enforced with Zod on both sides.
There is no generated OpenAPI document.

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

| Permission                                                                                | Roles                  |
| ----------------------------------------------------------------------------------------- | ---------------------- |
| read permissions                                                                          | all roles              |
| `jobs:retry`, `reconciliation:run`, `findings:update`, `repairs:execute`, `scenarios:run` | OWNER, ADMIN, OPERATOR |
| `members:manage`, `connections:manage`, `org:update`                                      | OWNER, ADMIN           |
| `org:delete`, `ownership:transfer`                                                        | OWNER                  |

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

| Method | Path                    | Permission                | Notes                                                                                      |
| ------ | ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `{org}/members`         | `members:read`            |                                                                                            |
| POST   | `{org}/members`         | `members:manage`          |                                                                                            |
| PATCH  | `{org}/members/:userId` | `members:manage`          | Role change; only an owner can grant or change OWNER, and the last owner cannot be demoted |
| DELETE | `{org}/members/:userId` | `members:manage`, or self | Leaving the org needs only `org:read`                                                      |

### Provider connections

| Method | Path                              | Permission           | Notes                                                          |
| ------ | --------------------------------- | -------------------- | -------------------------------------------------------------- |
| POST   | `{org}/connections`               | `connections:manage` | Mode `sandbox` or `simulation`; only sandbox API keys accepted |
| GET    | `{org}/connections`               | `connections:read`   | Returns `hasWebhookSecret` and `hasApiKey`, never secrets      |
| GET    | `{org}/connections/:connectionId` | `connections:read`   |                                                                |
| PATCH  | `{org}/connections/:connectionId` | `connections:manage` | Rotate webhook secret or API key, set `entitlementMap`         |

### Records

All need `records:read`.

| Method | Path                                                         |
| ------ | ------------------------------------------------------------ |
| GET    | `{org}/overview`                                             |
| GET    | `{org}/payments`, `{org}/payments/:paymentId`                |
| GET    | `{org}/subscriptions`, `{org}/subscriptions/:subscriptionId` |
| GET    | `{org}/customers`, `{org}/customers/:customerId`             |
| GET    | `{org}/entitlements`, `{org}/entitlements/:entitlementId`    |

### Events and jobs

| Method | Path                          | Permission    | Notes                                             |
| ------ | ----------------------------- | ------------- | ------------------------------------------------- |
| GET    | `{org}/events`                | `events:read` | Event inbox                                       |
| GET    | `{org}/events/:eventId`       | `events:read` | Redacted payload, attempts, job                   |
| GET    | `{org}/jobs/summary`          | `events:read` | Job counts by status                              |
| POST   | `{org}/events/:eventId/retry` | `jobs:retry`  | Sets the event back to `pending` and re-queues it |

### Reconciliation

| Method | Path                                                       | Permission           | Notes                                            |
| ------ | ---------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| POST   | `{org}/reconciliation/runs`                                | `reconciliation:run` | `{ connectionId?, mode }`; `409 RUN_IN_PROGRESS` |
| GET    | `{org}/reconciliation/runs`, `.../runs/:runId`             | `records:read`       |                                                  |
| GET    | `{org}/reconciliation/findings`, `.../findings/:findingId` | `records:read`       |                                                  |
| PATCH  | `{org}/reconciliation/findings/:findingId`                 | `findings:update`    | Status `reviewed` or `dismissed` only            |

### Incidents

| Method | Path                                             | Permission        | Notes                               |
| ------ | ------------------------------------------------ | ----------------- | ----------------------------------- |
| GET    | `{org}/incidents`, `{org}/incidents/:incidentId` | `records:read`    |                                     |
| POST   | `{org}/incidents/:incidentId/actions`            | `findings:update` | `acknowledge`, `note`, or `resolve` |

### Repairs

All need `repairs:execute`, an `Idempotency-Key` header, and a `reason` of 10 to 500 characters.
None of them write to a provider.

| Method | Path                                |
| ------ | ----------------------------------- |
| POST   | `{org}/repairs/reprocess-event`     |
| POST   | `{org}/repairs/correct-entitlement` |
| POST   | `{org}/repairs/resolve-finding`     |

Reusing a key with a different body answers `422 IDEMPOTENCY_KEY_REUSED`; see [architecture.md](architecture.md#repair-center).

### Scenario lab and audit

| Method | Path                              | Permission      | Notes                   |
| ------ | --------------------------------- | --------------- | ----------------------- |
| GET    | `{org}/scenarios`                 | `records:read`  | Catalog and latest runs |
| POST   | `{org}/scenarios/:scenarioId/run` | `scenarios:run` | Local simulation        |
| POST   | `{org}/scenarios/reset`           | `scenarios:run` | Deletes only lab data   |
| GET    | `{org}/scenario-runs/:runId`      | `records:read`  |                         |
| GET    | `{org}/audit`                     | `audit:read`    | Append-only log         |

### Machine routes

| Method | Path                                | Auth               | Notes                                                     |
| ------ | ----------------------------------- | ------------------ | --------------------------------------------------------- |
| POST   | `/webhooks/:provider/:connectionId` | Provider signature | `stripe`, `paypal`, `paddle`, `revenuecat`; 256 KiB limit |
| POST   | `/internal/tick`                    | `x-internal-token` | Registered only when `INTERNAL_TICK_TOKEN` is set         |

The connections, reconciliation, and webhook routes are registered only when `CREDENTIALS_ENCRYPTION_KEY` is set.

## Rate limits

Counters are stored in Postgres (`rate_limit_buckets`), so they hold across restarts and instances.

| Applied to                   | Policy                                               | Default                            |
| ---------------------------- | ---------------------------------------------------- | ---------------------------------- |
| Every authenticated route    | `authenticatedRead` / `authenticatedWrite` by method | 300 and 60 per minute per user     |
| Connection create and update | `credentialTest`, in addition                        | 5 per minute per user and org      |
| Reconciliation run start     | `reconciliationRun`, in addition                     | 5 per 10 minutes per org           |
| Scenario run and reset       | `scenarioRun`, in addition                           | 20 per 10 minutes per org          |
| Repair actions               | `repairAction`, in addition                          | 30 per 10 minutes per user and org |
| Webhooks                     | `webhookIngress`                                     | 600 per minute per connection      |
| `/internal/tick`             | `internalTick`                                       | 30 per minute per IP               |

Authenticated routes are `/api/v1/me` and every org route: orgs, members, connections, records, events, reconciliation, incidents, repairs, scenarios, audit, and overview.
Each policy can be overridden with `RATE_LIMIT_<POLICY>_MAX` and `RATE_LIMIT_<POLICY>_WINDOW_SEC`, for example `RATE_LIMIT_WEBHOOK_INGRESS_MAX`.
