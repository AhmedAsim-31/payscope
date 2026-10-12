# PayScope

## Project
Fintech portfolio prototype — payment operations, webhook reliability, reconciliation, and subscription-entitlement consistency. See `docs/PRD.md` for full spec.

## Stack
- **Frontend:** Next.js + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Fastify + TypeScript + Zod
- **Database:** Supabase PostgreSQL + Drizzle ORM
- **Monorepo:** pnpm

## Repository structure
```
apps/web/          Next.js frontend
apps/api/          Fastify backend + worker
packages/shared/   Shared contracts and types
packages/provider-adapters/
packages/test-utils/
supabase/migrations/
docs/
```

## Constraints
- No Cloudflare Workers or Hono
- No floating-point arithmetic for money — integer minor units only
- No paid services — $0 required spend
- Never expose Supabase service-role key to browser

## Tracking
- Jira: https://ahmedasim.atlassian.net/jira/software/projects/PAYSCOPE — tickets prefixed `PAYSCOPE-`
- GitHub: https://github.com/AhmedAsim-31/payscope (private)
- PR review: Cubic (`/cubic:run-review`)

## Key docs
- `docs/PRD.md` — full spec and definition of done
- `IMPLEMENTATION_STATUS.md` — current phase, completed work, next actions
