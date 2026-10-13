# Deployment

This is the planned $0 hosting setup, chosen in [provider-research.md](provider-research.md).
None of it is deployed yet; see "Status" at the end.
There is no `render.yaml`, `vercel.json`, pg_cron migration, or scheduled GitHub Actions workflow in the repo today.

## Topology

| Component         | Host                         | How it runs                                                                                       |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Web               | Vercel Hobby                 | `packages/web`, built with `next build`                                                           |
| API and worker    | Render Free web service      | One process: `node packages/api/dist/server.js`, worker in-process (`RUN_WORKER_IN_PROCESS=true`) |
| Database and auth | Supabase Free                | Postgres plus Supabase Auth; the API uses the pooler connection string                            |
| Tick              | Supabase pg_cron plus pg_net | Calls `POST /internal/tick` every few minutes to wake the API and drain the queue                 |
| Backup tick       | GitHub Actions schedule      | Same call, best effort, in case pg_cron is unavailable                                            |

Render Free sleeps after 15 minutes without inbound HTTP and takes about a minute to wake.
A sleeping API runs no jobs, so queued events wait until the next tick or request.
Supabase Free projects can pause after 7 days of low activity; the tick also keeps the project active.
Vercel cron is not used, because Hobby cron runs at most once a day.

## API on Render

- Build: `pnpm install && pnpm --filter @payscope/api build`.
- Start: `node packages/api/dist/server.js`.
- Health check path: `/ready`.
- Migrations: `pnpm --filter @payscope/api db:migrate` with `DATABASE_URL` set, before starting a new release.
  It runs from source through tsx; the build does not include the migration CLI.
- Set `NODE_ENV=production`, which makes `CORS_ORIGIN` and `CREDENTIALS_ENCRYPTION_KEY` required and turns on HSTS.
- Set `TRUST_PROXY=true` so rate limits key on the real client IP behind Render's proxy.
- Never run `db:seed` against production; the seed refuses `NODE_ENV=production` and remote hosts unless `SEED_ALLOW_REMOTE=true`.

## Web on Vercel

- Root directory `packages/web`, framework Next.js.
- Only the three `NEXT_PUBLIC_*` variables are needed; they are inlined at build time, so a change needs a rebuild.
- Never set `SUPABASE_SERVICE_ROLE_KEY` on Vercel.

## Tick

`/internal/tick` exists only when `INTERNAL_TICK_TOKEN` (16 or more characters) is set on the API.
It runs one lease recovery pass and one drain pass and returns `{"claimed": n, "recovered": n}`.

```bash
curl -X POST "$API_URL/internal/tick" -H "x-internal-token: $INTERNAL_TICK_TOKEN"
```

The pg_cron job and the GitHub Actions workflow that make this call are planned but not written.
pg_net availability on the Free plan is unverified.

## Environment variables

Names only; values belong in the host's secret store, never in the repo.
`.env.example` has placeholders and comments for each.

| Variable                               | API | Web | Notes                                              |
| -------------------------------------- | --- | --- | -------------------------------------------------- |
| `SUPABASE_URL`                         | yes |     | Required; JWT issuer and JWKS are derived from it  |
| `SUPABASE_JWKS_URL`                    | opt |     | Overrides the derived JWKS URL                     |
| `NEXT_PUBLIC_SUPABASE_URL`             |     | yes |                                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |     | yes |                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`            |     |     | Listed in `.env.example` but read by no code today |
| `DATABASE_URL`                         | yes |     | Supabase pooler string in deployed envs            |
| `DB_POOL_MAX`                          | opt |     | Default 10                                         |
| `TEST_DATABASE_URL`                    |     |     | Tests only                                         |
| `API_PORT`, `API_HOST`                 | opt |     | Defaults 3001 and 0.0.0.0                          |
| `CORS_ORIGIN`                          | yes |     | Comma-separated; required in production            |
| `LOG_LEVEL`                            | opt |     | Default `info`                                     |
| `TRUST_PROXY`                          | opt |     | `true` behind a proxy                              |
| `RUN_WORKER_IN_PROCESS`                | opt |     | Default `true`                                     |
| `INTERNAL_TICK_TOKEN`                  | opt |     | Enables `/internal/tick`                           |
| `NEXT_PUBLIC_API_URL`                  |     | yes | Public API base URL                                |
| `CREDENTIALS_ENCRYPTION_KEY`           | yes |     | 32-byte base64; required in production             |
| `CREDENTIALS_ENCRYPTION_KEY_VERSION`   | opt |     | Default 1, see [security.md](security.md)          |
| `CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS` | opt |     | Retired keys during a rotation                     |

The provider keys commented out in `.env.example` (`STRIPE_*`, `PAYPAL_*`, `PADDLE_*`, `REVENUECAT_*`) are read by no code.
Provider credentials are stored per connection, encrypted in the database, through the connections API.

Also read by code but not in `.env.example`: `NODE_ENV`, `SEED_ALLOW_REMOTE`, `DEMO_USER_PASSWORD` (E2E only), and the optional `RATE_LIMIT_<POLICY>_MAX` and `RATE_LIMIT_<POLICY>_WINDOW_SEC` overrides (see [api.md](api.md#rate-limits)).

## Status

| Item                                     | State                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Supabase project                         | Provisioned; Supabase Auth hosts the demo users                                                                 |
| Supabase database connection for the API | Not configured; blocked on the repo owner                                                                       |
| Migrations on Supabase                   | Unverified from this repo                                                                                       |
| Render service                           | Not created                                                                                                     |
| Vercel project                           | Not created                                                                                                     |
| pg_cron tick and GitHub Actions backup   | Not written                                                                                                     |
| Provider sandbox credentials             | None configured; all seeded connections are `simulation` mode                                                   |
| CI                                       | GitHub Actions runs format, lint, typecheck, migrations, tests, and build on a Postgres service; no deploy step |

## Troubleshooting

- `Invalid environment configuration: <NAMES>` at startup lists the variables that failed validation; values are never printed.
- `CREDENTIALS_ENCRYPTION_KEY not set; connections API and webhook ingress disabled` means those routes return 404.
- `/ready` answers 503 when the database is unreachable.
- First request after idle takes about a minute on Render Free.
