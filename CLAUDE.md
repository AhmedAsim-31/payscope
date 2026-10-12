# PayScope

## Project
Fintech portfolio prototype — payment operations, webhook reliability, reconciliation, and subscription-entitlement consistency. See `docs/PRD.md` for full spec.

## Stack
- **Frontend:** Next.js + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Fastify + TypeScript + Zod
- **Database:** Supabase PostgreSQL + Drizzle ORM
- **Monorepo:** pnpm + Turbo
- **Testing:** Vitest (unit/integration, all packages), Playwright (E2E)

## Repository structure
```
packages/
  web/                Next.js frontend       (@payscope/web)
  api/                Fastify backend + worker (@payscope/api)
  shared/             Shared contracts/types  (@payscope/shared)
  provider-adapters/  Provider integrations  (@payscope/provider-adapters)
  test-utils/         Test helpers           (@payscope/test-utils)
supabase/
  migrations/
docs/
scripts/
pnpm-workspace.yaml
package.json          (root — scripts only, no src)
turbo.json
tsconfig.base.json
eslint.config.mjs     (flat config)
```

## Constraints
- No Cloudflare Workers or Hono
- No floating-point arithmetic for money — integer minor units only
- No paid services — $0 required spend
- Never expose Supabase service-role key to browser

## Tracking
- Jira: https://ahmedasim.atlassian.net/jira/software/projects/PAYSCOPE — tickets prefixed `PAYSCOPE-`
- GitHub: https://github.com/AhmedAsim-31/payscope (public) — default branch: `master`
- PR review: Cubic (`/cubic:run-review`)

## Key docs
- `docs/PRD.md` — full spec and definition of done
- `IMPLEMENTATION_STATUS.md` — current phase, completed work, next actions
