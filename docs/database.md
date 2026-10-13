# Database

## Identity tables

`profiles` holds one row per Supabase auth user.
Its `id` equals the JWT `sub`, and it has no foreign key to `auth.users` because the local API database may differ from the auth database.
The API upserts the profile on every authenticated request, and only writes when the email changed.

`organizations` holds the tenants, with a unique `slug`.

`memberships` links a profile to an organization with a `member_role`.
It is unique on `(org_id, user_id)`, indexed on `user_id`, and cascades when either the organization or the profile is deleted.

## Roles and permission matrix

Roles are the `member_role` enum: `OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`.
The matrix lives in `packages/shared/src/permissions.ts` and is queried with `can(role, action)`.

| Action group                                                                                       | OWNER | ADMIN | OPERATOR | VIEWER |
| -------------------------------------------------------------------------------------------------- | ----- | ----- | -------- | ------ |
| Read: `org:read`, `members:read`, `connections:read`, `records:read`, `events:read`, `audit:read`  | yes   | yes   | yes      | yes    |
| Operate: `jobs:retry`, `reconciliation:run`, `findings:update`, `repairs:execute`, `scenarios:run` | yes   | yes   | yes      | no     |
| Manage: `org:update`, `members:manage`, `connections:manage`                                       | yes   | yes   | no       | no     |
| Owner only: `org:delete`, `ownership:transfer`                                                     | yes   | no    | no       | no     |

Only an `OWNER` can grant, change, or remove the `OWNER` role.
Any member can leave an organization on their own.
A caller who is not a member of an organization gets 404, so existence is not leaked.

## Last-owner guard

The trigger `memberships_guard_last_owner` runs before an update of `role` or a delete on `memberships`.
When the change would remove an `OWNER`, it locks the organization row with `FOR UPDATE` and counts the other owners.
If none remain it raises `P0001` with the message `last_owner`, which the API maps to 409 `LAST_OWNER`.
The lock serializes concurrent demotions, so two owners demoting each other cannot both succeed.
The check is skipped when the organization row no longer exists, so deleting an organization cascades cleanly.

## Row level security

RLS is enabled on every identity table.
The API connects as a privileged role and enforces authorization in code through `requireOrg`.
RLS is defense in depth for the Supabase Data API.
The `authenticated` role has `SELECT` only, with no write policies.
`profiles` rows are visible to their owner, and `organizations` and `memberships` rows are visible to members through `app.is_org_member(uuid)`.
That function is `SECURITY DEFINER` with an empty `search_path`, and only `authenticated` may execute it.

## Domain tables

Every tenant table has `org_id` referencing `organizations` with `ON DELETE CASCADE`, so deleting an organization removes all of its rows.
Child rows that reference a connection, customer, subscription, event, or job use composite foreign keys on `(org_id, <id>)`.
The parent carries a matching `unique (org_id, id)`, so a row can never point at a parent in another organization.
Money is `amount_minor bigint` in minor units plus `currency char(3)` with a check that it matches `^[A-Z]{3}$`.
Timestamps are `timestamptz`.

### provider_connections

One row per connected provider account, with `provider`, `mode` (`sandbox` or `simulation`), and `status`.
It is unique on `(org_id, provider, external_account_id)`, so one account cannot be connected twice in an organization.
`credentials_ciphertext` and `credentials_key_version` hold encrypted credentials and are not granted to `authenticated`.
`entitlement_map` (`jsonb`, default `{}`) maps a plan reference to entitlement keys, is validated by the API, and is granted to `authenticated` because it is not secret.
There are no secondary indexes because organizations have only a handful of connections.

### customers and provider_customer_mappings

`customers` is the provider-neutral customer, indexed on `(org_id, created_at desc)` for the customer list.
`provider_customer_mappings` links a customer to its id at a provider, unique on `(connection_id, provider_customer_id)`.
That unique index serves the webhook lookup from a provider customer id to the customer.
The index on `customer_id` serves the reverse lookup and the cascade from `customers`.

### payment_records

One row per provider payment, unique on `(connection_id, provider_payment_id)`, which serves upserts from events and reconciliation.
Checks require `amount_minor >= 0` and `0 <= amount_refunded_minor <= amount_minor`.
`last_event_at` and `version` let writers ignore out-of-order events and detect concurrent updates.
`(org_id, created_at desc)` serves the payments list and `(org_id, status)` serves status filters.

### subscription_records

One row per provider subscription, unique on `(connection_id, provider_subscription_id)`.
It requires a customer and carries the same `last_event_at` and `version` guards as payments.
`(org_id, created_at desc)` serves the list and `(org_id, status)` serves status filters.

### entitlement_records

The access a customer should currently have, unique on `(org_id, customer_id, entitlement_key)`.
`subscription_id` is optional and, when set, must belong to the same organization.
`state` can be `inconsistent` so reconciliation can flag a mismatch without deleting the row.
`(org_id, state)` serves the entitlement list and the inconsistent filter.

### provider_events

The raw inbound event ledger, unique on `(connection_id, provider_event_id)`, which makes webhook redelivery idempotent per connection.
The same provider event id on a different connection is allowed.
`payload` is jsonb with a check of `pg_column_size(payload) <= 262144`, the 256 KB cap that ingress also enforces after redaction.
`(org_id, received_at desc)` serves the event feed and `(org_id, status)` serves the needs-attention and failed filters.

### event_processing_attempts

One row per processing attempt for an event, unique on `(event_id, attempt_number)`.
It records the outcome, the `failure_category`, whether the failure is retryable, and `next_retry_at`.
It cascades when its event is deleted and optionally references the job that ran it.
The unique index also serves the per-event attempt history.

### background_jobs

A Postgres-backed queue.
`org_id` is nullable so system jobs have no tenant, and `idempotency_key` is unique when present.
`attempt_count` and `max_attempts` have no upper-bound check, so a job can be moved to `dead` at the limit and re-queued with a higher `max_attempts`.
The partial index on `available_at where status = 'queued'` serves job claiming.
The partial index on `lease_expires_at where status = 'running'` serves the expired-lease sweeper.

### idempotency_records

Stored responses for idempotent API requests, unique on `(org_id, scope, key)`, which is also the lookup path.
`expires_at` supports cleanup.

### reconciliation_runs

One reconciliation execution with `mode` (`local` or `provider`), an optional `connection_id`, `scope`, a `checkpoint` jsonb, five counters, an `error` text, and `triggered_by`.
A partial unique index on `(org_id, coalesce(connection_id, zero uuid)) where status = 'running'` allows one active run per connection.
Counters are incremented in the same transaction as the findings and checkpoint of each batch.

### reconciliation_findings

One finding per detected inconsistency, with `type`, `severity`, `status` (`open`, `reviewed`, `resolved`, `dismissed`), the subject, `evidence`, and `recommended_action`.
`first_seen_run_id` and `last_seen_run_id` reference runs in the same org.
A partial unique index on `(org_id, fingerprint) where status in ('open', 'reviewed')` makes re-detection an upsert.

### Domain row level security

`authenticated` has `SELECT` with a policy of `app.is_org_member(org_id)` on every domain table except `idempotency_records`.
`background_jobs` only exposes rows where `org_id` is not null.
`idempotency_records` has RLS enabled with no grant and no policy, so it is invisible to `authenticated`.
On `provider_connections` the grant is column-level and leaves out the credential columns.

## Local compatibility shim

The first migration creates the `anon`, `authenticated`, and `service_role` roles, an `auth.users` table, and `auth.uid()` when they are missing.
It is a no-op on Supabase, and lets plain local Postgres run the same RLS policies.
Tests set the caller with `select set_config('request.jwt.claim.sub', <uuid>, true)` after `set local role authenticated`.

## Migrations

Schema files live in `packages/api/src/db/schema`, one per domain.
Run `pnpm --filter @payscope/api db:generate --name=<name>` after editing them.
SQL that drizzle-kit cannot express goes in a `--custom` migration, as in `identity_guards`.
