# Architecture

## Webhook ingress

Provider webhooks arrive at `POST /webhooks/:provider/:connectionId`.
The route is outside `/api/v1` and has no user authentication; the signature is the credential.
It lives in an encapsulated Fastify plugin with its own buffer JSON parser and a 256 KiB body limit.

```mermaid
sequenceDiagram
    participant P as Provider
    participant A as Ingress route
    participant D as Postgres
    participant W as Worker
    P->>A: POST raw JSON body + signature header
    A->>A: Enforce 256 KiB body limit (413)
    A->>A: Keep raw bytes as a Buffer
    A->>D: Load connection by id AND provider (404 if unknown or disabled)
    A->>A: Decrypt webhook secrets (AES-256-GCM)
    A->>A: Verify signature, constant time, 5 minute replay window
    A-->>P: 400 WEBHOOK_SIGNATURE_INVALID (no rows written)
    A->>A: Parse JSON, identify event id, type, time
    A->>D: BEGIN
    A->>D: INSERT provider_events ON CONFLICT (connection_id, provider_event_id) DO NOTHING
    A->>D: INSERT background_jobs (idempotency key event:id) only if the event was inserted
    A->>D: COMMIT
    A-->>P: 200 received true, duplicate flag
    W->>D: Claim job and process the event later
```

## Guarantees

Invalid signatures never create a row, a job, or any other work.
The raw request bytes are verified, never a re-serialized body.
The event row is committed before the provider receives a 2xx.
Deduplication is decided by the `provider_events_connection_event_unique` constraint, so concurrent deliveries of one event produce exactly one event row.
The job is inserted in the same transaction as the event, so an event never exists without its job.
A duplicate delivery writes nothing, enqueues nothing, and still returns 200.
No event processing runs in the request handler; the worker owns it.
No external HTTP call happens inside the database transaction.
Unsupported event types are persisted with `normalized_type` set to `unsupported` so the worker can mark them ignored.
Live-mode or otherwise invalid-input events get a 422 and persist nothing.
Logs carry the provider, connection id, and failure reason only; never the body, headers, signature, or secrets.

## Job worker

Background work runs from the `background_jobs` table; Postgres is the queue.
A worker claims jobs with one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` statement, so concurrent workers never receive the same job.
The claim sets `status = running`, `locked_by`, a lease expiry, and increments `attempt_count` in that same statement.
Completing or failing a job is conditional on `status = running AND locked_by = <worker>`, so a worker that lost its lease cannot overwrite state and learns this from a `false` return.
A lost lease is logged and never thrown.
While a handler runs longer than half the lease, the worker extends the lease with the same ownership condition, so slow jobs are not run twice.
No database transaction is held across a handler.
Recovery is a single `UPDATE` that moves running jobs with an expired lease back to `queued`, or to `dead` once attempts are exhausted, and clears `locked_by`.
The worker recovers on start and every 30 polls.
Retryable failures return to `queued` with `available_at` set by exponential backoff with full jitter (base 5 seconds, cap 15 minutes).
A failure is retryable for a retryable `ProviderError` or any unknown error; a non-retryable `ProviderError` or a `PermanentJobError` goes straight to `dead`.
A job also goes to `dead` when `attempt_count` reaches `max_attempts`, and an unknown job kind goes to `dead` with `unsupported_job_kind`.
`dead` is the dead-letter state: the row stays with a sanitized `last_error` truncated to 1000 characters and is never retried automatically.
Logs carry the job id, kind, attempt, duration, and outcome; never the payload.
The `process_provider_event` handler re-normalizes the stored payload and applies it as described in "Event processing".

### Hosting modes

By default the worker runs inside the API process (`RUN_WORKER_IN_PROCESS=true`) and is stopped before the database pool closes on shutdown.
The same worker is importable as its own process: `pnpm --filter @payscope/api worker`, or `node dist/worker-main.js` after a build.
Set `RUN_WORKER_IN_PROCESS=false` on the API when running a standalone worker.
`POST /internal/tick` runs one recovery pass and one drain pass for hosts that sleep between requests.
It requires the `x-internal-token` header, compared in constant time to `INTERNAL_TICK_TOKEN`, and is not registered when the token is unset.

## Event processing

The handler normalizes the stored payload outside any transaction, then runs `applyEvent` in one transaction.
That transaction claims the event, applies every record write, and inserts the `event_processing_attempts` row.
A crash therefore cannot leave records applied while the event is still pending.
No external HTTP call happens inside the transaction.

### Claim and idempotency

The first statement is `UPDATE provider_events SET status = 'processed' ... WHERE status IN ('pending', 'processing', 'failed') RETURNING`.
A concurrent duplicate run blocks on that row, then matches nothing, writes nothing, and returns.
An empty claim is a real outcome (`already_handled`), not an error.

### Ordering rule

Every record carries `last_event_at`, the provider `occurredAt` of the last event applied to it.
A write is a guarded upsert: `INSERT ... ON CONFLICT DO UPDATE ... WHERE last_event_at IS NULL OR last_event_at <= EXCLUDED.last_event_at RETURNING`.
The condition and the write are one statement, so a read-then-write race cannot exist.
An empty `RETURNING` means the event is older than the stored state.
The event is then marked `ignored` and the attempt row records `outcome = skipped` with `error_message = stale_event`.
Events with identical timestamps apply in arrival order.
Each applied write increments `version` once.

### Object rules

Payments are keyed by `(connection_id, provider_payment_id)`.
Amount and currency are set on insert and never overwritten.
A refund sets `amount_refunded_minor`, capped at `amount_minor`, and the status becomes `refunded` or `partially_refunded`.
Stripe refund amounts are cumulative; other providers' refund amounts are added.
If a refund is the first event seen for a payment, the row is created with the refunded amount as its amount.
Subscriptions are keyed by `(connection_id, provider_subscription_id)` and take `current_period_end` from event metadata when present.
A subscription event with no provider customer for an unknown subscription fails with `state_conflict` and the event needs attention.
Customers are resolved through `provider_customer_mappings`; a missing mapping creates a `customers` row in the same transaction, and a lost race deletes that row and re-selects the winner.
A dispute marks the matching payment `disputed`; with no matching payment the event is still `processed` and the attempt row carries a note, so no orphan rows are created.

### Entitlement policy

Entitlements are written only for events that carry `entitlementKeys`, per key, with source `provider_event`.
Created and renewed events set `active`, keep the original `granted_at`, and set `expires_at` when the event carries an expiry.
An expiration sets `expired`.
A refund sets `revoked` and `revoked_at`.
A cancellation never changes an entitlement: access continues until the expiration event arrives.
Entitlement writes use the same `last_event_at` guard.

### Attempt categories

Every processing try writes one attempt row with `failure_category` taken from the `ProviderError` category: `transient`, `permanent`, `invalid_input`, `provider_auth`, `unsupported_event`, or `state_conflict`.
`not_found` maps to `permanent` and `unavailable` maps to `transient`.
Other errors count as `transient`.
A retryable failure sets the event to `failed` and the job returns to `queued` with backoff.
A non-retryable failure, or a retryable one on the job's last attempt, sets the event to `needs_attention` and the job to `dead`.
Unsupported event types are `ignored` with `unsupported_event`.

## Provider connection secrets

The ingress route passes the decrypted `webhookSecrets` to `verifyWebhook` unchanged.
Stripe: each secret is a signing secret (`whsec_...`); any of the two may match.
Paddle: each secret is a notification destination secret key; any of the two may match.
RevenueCat: each secret is either the expected `Authorization` header value or an HMAC signing secret.
PayPal: `secrets[0]` is the webhook id from the PayPal developer dashboard, not a signing key.
Live-mode events (Stripe `livemode`, RevenueCat `PRODUCTION`) are rejected with `ProviderError.reason = 'live_mode'`, which ingress turns into a 422.

## Credentials at rest

Webhook secrets and API keys are stored as one AES-256-GCM blob in `provider_connections.credentials_ciphertext`.
The layout is a version byte, a 12-byte random IV, the ciphertext, and a 16-byte tag.
The connection id is bound as additional authenticated data, so a blob cannot be moved to another row.
The key comes from `CREDENTIALS_ENCRYPTION_KEY` (base64, 32 bytes) and is required in production.
At most two webhook secrets are kept per connection, so a rotation accepts the old and new secret together.
The connections API returns `hasWebhookSecret` and `hasApiKey` and never returns secrets or ciphertext.
Only sandbox API keys are accepted.
