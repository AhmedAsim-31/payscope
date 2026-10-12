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

## Local compatibility shim

The first migration creates the `anon`, `authenticated`, and `service_role` roles, an `auth.users` table, and `auth.uid()` when they are missing.
It is a no-op on Supabase, and lets plain local Postgres run the same RLS policies.
Tests set the caller with `select set_config('request.jwt.claim.sub', <uuid>, true)` after `set local role authenticated`.

## Migrations

Schema files live in `packages/api/src/db/schema`, one per domain.
Run `pnpm --filter @payscope/api db:generate --name=<name>` after editing them.
SQL that drizzle-kit cannot express goes in a `--custom` migration, as in `identity_guards`.
