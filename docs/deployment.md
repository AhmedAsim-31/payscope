# Deployment

This is the planned $0 hosting setup, chosen in [provider-research.md](provider-research.md).
None of it is deployed yet; see "Status" at the end.
The repo carries the config for it: [`render.yaml`](../render.yaml), [`supabase/cron/tick.sql`](../supabase/cron/tick.sql), and [`.github/workflows/tick-backup.yml`](../.github/workflows/tick-backup.yml).
There is no `vercel.json`; the web project needs only dashboard settings (see "Web on Vercel").

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

[`render.yaml`](../render.yaml) is a Render Blueprint for one Free web service, `payscope-api`.
It validates against Render's published Blueprint schema; it has not been applied to a Render account.

- Build: `corepack enable && pnpm install --no-frozen-lockfile --prod=false && pnpm --filter @payscope/api build`.
  `--prod=false` keeps the dev dependencies (tsdown) that `NODE_ENV=production` would otherwise skip.
  `--no-frozen-lockfile` matches CI, since `pnpm-lock.yaml` is not committed.
  Corepack picks the pnpm version from `packageManager` in the root `package.json`; whether Render's Node image allows `corepack enable` is unverified.
- Start: `node packages/api/dist/server.js`.
- Health check path: `/ready`.
- Node version comes from `.nvmrc` (24).
- `API_PORT` is set to 10000, the port Render routes to by default.
- Auto deploy waits for GitHub checks to pass (`autoDeployTrigger: checksPass`), and the build filter skips commits that touch only the web package or docs.
- Secrets are declared with `sync: false`, so Render prompts for them once when the Blueprint is created: `SUPABASE_URL`, `DATABASE_URL`, `CORS_ORIGIN`, `CREDENTIALS_ENCRYPTION_KEY`, `INTERNAL_TICK_TOKEN`.
- Migrations: `pnpm --filter @payscope/api db:migrate` with `DATABASE_URL` set, before starting a new release.
  It runs from source through tsx; the build does not include the migration CLI.
  It runs from a workstation, because Render's pre-deploy command is not available on the Free plan.
- Set `NODE_ENV=production`, which makes `CORS_ORIGIN` and `CREDENTIALS_ENCRYPTION_KEY` required and turns on HSTS.
- Set `TRUST_PROXY=true` so rate limits key on the real client IP behind Render's proxy.
- Never run `db:seed` against production; the seed refuses `NODE_ENV=production` and remote hosts unless `SEED_ALLOW_REMOTE=true`.

## Web on Vercel

No `vercel.json` is needed; these are project settings in the Vercel dashboard.

- Root directory `packages/web`, framework preset Next.js, build and install commands left at their defaults.
- Vercel detects the pnpm workspace and the pnpm version from `packageManager` in the root `package.json`, and installs from the repo root.
- Keep "Include files outside the root directory" on, since `@payscope/shared` lives in `packages/shared`.
- Only the three `NEXT_PUBLIC_*` variables are needed; they are inlined at build time, so a change needs a rebuild.
- Never set `SUPABASE_SERVICE_ROLE_KEY` on Vercel.

## Tick

`/internal/tick` exists only when `INTERNAL_TICK_TOKEN` (16 or more characters) is set on the API.
It runs one lease recovery pass and one drain pass and returns `{"claimed": n, "recovered": n}`.

```bash
curl -X POST "$API_URL/internal/tick" -H "x-internal-token: $INTERNAL_TICK_TOKEN"
```

Two schedulers make this call; both are in the repo, neither is running yet.

- [`supabase/cron/tick.sql`](../supabase/cron/tick.sql) schedules a pg_cron job, `payscope-tick`, every 5 minutes, which POSTs through pg_net.
  The API base URL and the token are read from Supabase Vault (`payscope_api_base_url`, `payscope_internal_tick_token`), never written in the SQL.
  It is not a migration: local Homebrew Postgres and CI have no pg_cron or pg_net, so it is applied by hand on Supabase only.
  pg_net availability on the Free plan is unverified.
- [`.github/workflows/tick-backup.yml`](../.github/workflows/tick-backup.yml) makes the same call every 10 minutes and on manual dispatch.
  It reads the repo secrets `API_BASE_URL` and `INTERNAL_TICK_TOKEN`, and exits green with a notice when either is unset.
  GitHub can delay or drop scheduled runs under load, and disables schedules in repos with no activity for 60 days, so this is best effort.

## Owner steps

These need the repo owner's accounts; none have been done.

1. Resolve PAYSCOPE-45, then run `pnpm --filter @payscope/api db:migrate` against the Supabase pooler `DATABASE_URL`.
2. Generate the secrets: `openssl rand -hex 24` for `INTERNAL_TICK_TOKEN`, `openssl rand -base64 32` for `CREDENTIALS_ENCRYPTION_KEY`.
3. In Render, create a Blueprint from this repo and enter the `sync: false` values when prompted.
   `CORS_ORIGIN` is the Vercel production URL, so set it after step 4 if it is not known yet.
4. In Vercel, import the repo with the settings in "Web on Vercel" and set the three `NEXT_PUBLIC_*` variables; `NEXT_PUBLIC_API_URL` is the Render service URL.
5. In Supabase, store the two Vault secrets listed at the top of `supabase/cron/tick.sql`, then run that file in the SQL editor.
   Check runs with `select * from cron.job_run_details order by start_time desc limit 5;` and responses with `select * from net._http_response order by created desc limit 5;`.
6. In GitHub, add the repo secrets `API_BASE_URL` (the Render service URL) and `INTERNAL_TICK_TOKEN`, then run "Tick backup" once by hand.

## Environment variables

Names only; values belong in the host's secret store, never in the repo.
`.env.example` has placeholders and comments for each.

| Variable                                 | API | Web | Notes                                             |
| ---------------------------------------- | --- | --- | ------------------------------------------------- |
| `SUPABASE_URL`                           | yes |     | Required; JWT issuer and JWKS are derived from it |
| `SUPABASE_JWKS_URL`                      | opt |     | Overrides the derived JWKS URL                    |
| `NEXT_PUBLIC_SUPABASE_URL`               |     | yes |                                                   |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`   |     | yes |                                                   |
| `DATABASE_URL`                           | yes |     | Supabase pooler string in deployed envs           |
| `DB_POOL_MAX`                            | opt |     | Default 10                                        |
| `TEST_DATABASE_URL`                      |     |     | Tests only                                        |
| `API_PORT`, `API_HOST`                   | opt |     | Defaults 3001 and 0.0.0.0                         |
| `CORS_ORIGIN`                            | yes |     | Comma-separated; required in production           |
| `LOG_LEVEL`                              | opt |     | Default `info`                                    |
| `TRUST_PROXY`                            | opt |     | `true` behind a proxy                             |
| `RUN_WORKER_IN_PROCESS`                  | opt |     | Default `true`                                    |
| `INTERNAL_TICK_TOKEN`                    | opt |     | Enables `/internal/tick`                          |
| `RECONCILIATION_SCHEDULE_INTERVAL_HOURS` | opt |     | Default 24; `0` turns scheduled runs off          |
| `RETENTION_*_DAYS`                       | opt |     | See [operations.md](operations.md#data-retention) |
| `NEXT_PUBLIC_API_URL`                    |     | yes | Public API base URL                               |
| `CREDENTIALS_ENCRYPTION_KEY`             | yes |     | 32-byte base64; required in production            |
| `CREDENTIALS_ENCRYPTION_KEY_VERSION`     | opt |     | Default 1, see [security.md](security.md)         |
| `CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS`   | opt |     | Retired keys during a rotation                    |

Provider credentials are stored per connection, encrypted in the database, through the connections API.

Also read by code: `NODE_ENV`, `SEED_ALLOW_REMOTE`, `DEMO_USER_PASSWORD` (E2E only), and the optional `RATE_LIMIT_<POLICY>_MAX` and `RATE_LIMIT_<POLICY>_WINDOW_SEC` overrides (see [api.md](api.md#rate-limits)).

## Status

| Item                                     | State                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Supabase project                         | Provisioned; Supabase Auth hosts the demo users                                                                 |
| Supabase database connection for the API | Not configured; blocked on the repo owner                                                                       |
| Migrations on Supabase                   | Unverified from this repo                                                                                       |
| Render service                           | Not created; `render.yaml` added                                                                                |
| Vercel project                           | Not created                                                                                                     |
| pg_cron tick and GitHub Actions backup   | Added, not applied or scheduled against a live API                                                              |
| Provider sandbox credentials             | None configured; all seeded connections are `simulation` mode                                                   |
| CI                                       | GitHub Actions runs format, lint, typecheck, migrations, tests, and build on a Postgres service; no deploy step |

## Troubleshooting

- `Invalid environment configuration: <NAMES>` at startup lists the variables that failed validation; values are never printed.
- `CREDENTIALS_ENCRYPTION_KEY not set; connections API and webhook ingress disabled` means those routes return 404.
- `/ready` answers 503 when the database is unreachable.
- First request after idle takes about a minute on Render Free.
