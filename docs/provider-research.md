# PayScope research (Phase 0)

Researched 2026-10-13 for PAYSCOPE-11, PAYSCOPE-12, and PAYSCOPE-13.
Versions come from `npm view` on that date.
Items marked (unverified) were not confirmed against a primary source and must be checked before they are relied on in code.

## Summary of decisions

| Area | Decision |
|---|---|
| Frontend | Next.js 16.4 (latest stable major) with React 19, App Router, Tailwind 4, shadcn/ui in `packages/web`, TanStack Query 5 |
| API | Fastify 5.12 with helmet, cors, sensible, rate-limit, `fastify-type-provider-zod` 7, pino with redaction |
| Webhook raw body | Encapsulated plugin with `addContentTypeParser('application/json', { parseAs: 'buffer' })`, no extra dependency |
| Auth | Supabase asymmetric JWT signing keys, verified in Fastify with `jose` against the project JWKS |
| Database | Supabase Postgres via Drizzle ORM 0.45 (stable) and drizzle-kit 0.31, postgres-js with `prepare: false` |
| Validation | Zod 4.6, `import { z } from 'zod'`; drizzle-zod 0.8 for schema-derived validators |
| Tooling | Node 24 LTS, TypeScript 6.0.x, ESLint 10 flat config + typescript-eslint 8.71, Vitest 5, Turbo 2.11 |
| Hosting | Web on Vercel Hobby; API with in-process worker on Render Free; pg_cron tick plus GitHub Actions backup |
| Providers | Stripe and Paddle with full adapters; PayPal and RevenueCat with real verifiers and fixture-driven flows |

The overnight brief named Next.js 15; Next.js 16 is the latest stable major and the project rule is to never pin to an older major, so 16 is used.

## Stack research (PAYSCOPE-11)

### Next.js 16.4.0

- Peer `react ^18.2 || ^19`; use React 19.x. Node `>=20.9`.
- `fetch` is not cached by default; opt in with `cache: 'force-cache'`.
  `cacheComponents` and `'use cache'` are opt-in and not used here.
- Server Components are the default; client data fetching uses TanStack Query in `'use client'` islands.
- Only `NEXT_PUBLIC_*` variables reach the browser bundle, inlined at build time.
  The Supabase secret key must never use that prefix.
- Tailwind 4 uses `@import "tailwindcss"` plus `@tailwindcss/postcss`, with no `tailwind.config.js` (unverified).
- shadcn/ui is initialised directly in `packages/web` rather than a shared UI package (unverified CLI flow).
- TanStack Query 5: create the `QueryClient` in a client `Providers` component with `useState`; set a default `staleTime` above 0 (unverified).
- Source: https://nextjs.org/docs

### Fastify 5.12.5

- Plugins: @fastify/helmet 13.1.2, @fastify/cors 11.3.1, @fastify/sensible 6.0.7, @fastify/rate-limit 11.2.1; pino 10.4.0.
- `fastify-type-provider-zod` 7.0.0 peers `zod >=4.1.5`, `fastify ^5.5`, `@fastify/swagger >=9.5.1`.
- Raw body for webhooks: register a JSON parser with `parseAs: 'buffer'` inside an encapsulated plugin that holds only webhook routes, verify the signature on the bytes, then `JSON.parse`.
- pino `redact` covers `req.headers.authorization` and provider signature headers.
- `setErrorHandler` returns one safe error shape; Zod validation errors map to 400.
- Source: https://fastify.dev/docs/latest

### Supabase (supabase-js 2.117.3, @supabase/ssr 0.12.7)

- With asymmetric signing keys, the API verifies access tokens locally with `jose` `createRemoteJWKSet(new URL('https://<ref>.supabase.co/auth/v1/.well-known/jwks.json'))` and `jwtVerify`.
- `getClaims()` checks signature and expiry only; `getUser()` also detects server-side revocation at the cost of a network call.
- Key types: `sb_publishable_...` (browser safe, subject to RLS) and `sb_secret_...` (server only, bypasses RLS). Legacy anon and service_role keys still exist.
- RLS enabled with no policies denies all Data API access to non-bypass roles.
  The Fastify API connects as a privileged role, so authorization is enforced in application code, with RLS as defense in depth.
- Pooling: Supavisor transaction mode on port 6543 needs `prepare: false`; session mode and direct connections use 5432 (unverified). The direct host is IPv6 only on the free plan (unverified).
- Source: https://supabase.com/docs/guides/auth/jwts

### Drizzle ORM 0.45.4 and drizzle-kit 0.31.11

- `drizzle-kit generate` writes SQL migrations; `drizzle-kit migrate` applies them. `push` is for prototyping only.
- Driver: `postgres(url, { prepare: false })` with `drizzle({ client })` from `drizzle-orm/postgres-js` (postgres 3.4.9).
- RLS helpers: `pgPolicy` and `pgRole` in `drizzle-orm/pg-core`; `drizzle-orm/supabase` exports `authenticatedRole`, `serviceRole`, `anonRole`.
- The built-in `drizzle-orm/zod` export exists only in the 1.0 beta; stable uses `drizzle-zod` 0.8.3 (peers `zod ^3.25 || ^4`).
  drizzle-zod needs `module: "ES2022"` and `moduleResolution: "bundler"`.
- Source: https://orm.drizzle.team/docs/connect-supabase

### Zod 4.6.7

- `import { z } from 'zod'`.
- Top-level formats: `z.email()`, `z.uuid()`, `z.url()`, `z.iso.datetime()`, `z.int()`.
- Error customisation uses a single `error` parameter.
- Source: https://zod.dev/v4

### Tooling

- Vitest 5.0.4 (Node `^22.12 || ^24 || >=26`), Turbo 2.11.7, Playwright 1.64.0, Prettier 3.9.
- Node LTS is v24 "Krypton".
- TypeScript 7.0.2 is the latest, but typescript-eslint 8.71.2 supports only `typescript >=4.8.4 <6.1.0`.
  TypeScript is pinned to 6.0.x until typescript-eslint supports 7.
- ESLint 10.12.0 with a flat `eslint.config.mjs`.

## Provider research (PAYSCOPE-12)

Items marked (unverified) were not confirmed against primary docs during research.

### Stripe (test mode)

- Access: free test mode/sandbox; `stripe listen --forward-to localhost:PORT/...` forwards events locally and prints a session `whsec_` secret.
- Signature: header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=...]`.
  `v1` is HMAC-SHA256 hex of `"<t>.<raw body>"` keyed by the `whsec_` secret.
  Accept any matching `v1` (secret rotation sends several); ignore other schemes.
  Default tolerance 300s. Raw body required.
- SDK: `stripe` npm 23.0.0; `stripe.webhooks.constructEvent(rawBody, header, secret, tolerance?)`, `generateTestHeaderString({ payload, secret })` for tests.
- Dedup: `evt_...` id. Stripe can emit two events for one change, so dedup on object id + type as well.
- Retries: live up to 3 days with exponential backoff; sandbox 3 times over a few hours. Any 2xx is success.
- Ordering: not guaranteed; `created` is in seconds and ties. Re-fetch the object rather than trusting arrival order.
- Key events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created|updated|closed`, `customer.subscription.created|updated|deleted`, `invoice.paid` (renewal when `billing_reason=subscription_cycle`), `invoice.payment_failed`.
- Reconciliation: `GET /v1/charges`, `/v1/payment_intents`, `/v1/refunds`, `/v1/disputes`, `/v1/balance_transactions`, `/v1/subscriptions`, `/v1/invoices`, `/v1/events` (30 days); cursor `starting_after`, filter `created[gte]`.
- Money: integer minor units plus lowercase `currency`. Zero-decimal currencies (JPY) are whole units.
- Rate limits: about 25 req/s sandbox, 100 req/s live (unverified).
- Sources: https://docs.stripe.com/webhooks, https://github.com/stripe/stripe-node

### PayPal (sandbox)

- Access: free developer account with sandbox accounts; real webhooks need a public HTTPS URL. Simulator mock events cannot be verified via the postback API.
- Headers: `paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig` (base64), `paypal-cert-url`, `paypal-auth-algo`. `webhook_id` comes from configuration, not the request.
- Local verification: message `transmissionId|transmissionTime|webhookId|crc32(rawBody)` (decimal unsigned CRC32), verified as SHA256withRSA against the cert at `cert-url` (host must be PayPal; cache the cert).
- Postback alternative: `POST /v1/notifications/verify-webhook-signature`, returns `SUCCESS` or `FAILURE`. One API call per event.
- Tolerance: none documented; we enforce our own window on `transmission-time`.
- Retries: up to 25 over 3 days for non-2xx.
- SDK: `@paypal/paypal-server-sdk` 2.5.0; no confirmed webhook helper, so verify with Node `crypto`.
- Key events: `PAYMENT.CAPTURE.COMPLETED|DENIED|REFUNDED|REVERSED`, `BILLING.SUBSCRIPTION.CREATED|ACTIVATED|CANCELLED|SUSPENDED|EXPIRED|PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`, `CUSTOMER.DISPUTE.CREATED|RESOLVED`.
- Reconciliation: `GET /v1/reporting/transactions` (31-day window, up to ~3h lag, needs permission; unverified), `GET /v2/payments/captures/{id}`, `GET /v1/billing/subscriptions/{id}`.
- Money: decimal strings `{ currency_code, value: "10.00" }`; parse to minor units with a currency exponent table, no floats.
- Sources: https://developer.paypal.com/api/rest/webhooks/rest/, https://developer.paypal.com/docs/api/transaction-search/v1/

### Paddle Billing (sandbox)

- Access: free sandbox account (sandbox-vendors.paddle.com) with its own keys.
- Signature: header `Paddle-Signature: ts=<unix>;h1=<hex>` (several `h1` during rotation).
  `h1` is HMAC-SHA256 hex of `"<ts>:<raw body>"` keyed by the destination secret.
  Paddle's sample uses a 5s tolerance; we use a few minutes.
- SDK: `@paddle/paddle-node-sdk` 3.10.0; `paddle.webhooks.unmarshal(rawBody, secret, signature)`.
- Dedup: `event_id` (`evt_...`); replays get a new `ntf_` notification id but keep the event id.
- Retries: sandbox 3 within 15 min; live 60 within 3 days. Respond 200 within 5s.
- Ordering: not guaranteed; compare `occurred_at`.
- Key events: `transaction.completed|paid|payment_failed`, `adjustment.created|updated` (refunds, chargebacks), `subscription.created|activated|updated|canceled|paused|resumed|past_due`.
- Reconciliation: `GET /transactions`, `/subscriptions`, `/adjustments`, `/events`; cursor `after`, filters such as `updated_at[GTE]`.
- Money: lowest-denomination strings (`"2499"`), uppercase ISO 4217.
- Rate limits: 240 req/min per IP; 429 with `Retry-After`.
- Sources: https://developer.paddle.com/webhooks/about/signature-verification, https://developer.paddle.com/api-reference/about/data-types, https://developer.paddle.com/api-reference/about/rate-limiting

### RevenueCat (Test Store / sandbox)

- Access: free project; Test Store needs no App Store or Play setup. Test subscriptions renew every 5 min up to 5 times.
- Auth: shared-secret `Authorization` header configured in the dashboard, compared in constant time.
  Optional HMAC: `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>` over `"<t>.<raw body>"`.
- Dedup: `event.id` (UUID); retries reuse it. At-least-once delivery.
- Retries: 5 retries at 5, 10, 20, 40, 80 minutes; 60s timeout; anything other than 200 fails.
- Key events: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_PAUSED`, `TRANSFER`, `TEST`. Each event carries `entitlement_ids`.
- Reconciliation: `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` with a secret key; v2 under `/v2/projects/{id}/customers/...`.
- Money: `price` and `price_in_purchased_currency` are JSON floats. Convert via string decimal with a currency exponent, never float math.
- Sources: https://www.revenuecat.com/docs/integrations/webhooks, https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields, https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store

### Decisions

- Normalized event: `provider`, `provider_event_id` (unique with provider), raw `event_type`, `normalized_type`, `occurred_at` (provider time), `received_at`, object id, customer ref, `amount_minor` (bigint, nullable), uppercase `currency`, `raw_payload` jsonb, `signature_verified`, processing status, attempts.
- Never rely on arrival order. Apply a state change only when `occurred_at` is newer than the stored version; reconciliation re-reads provider truth.
- Persist and return 2xx fast; the worker does processing.
- Stripe and Paddle get full signature verification and adapters. PayPal and RevenueCat verifiers are real; their event flows are fixture-driven.
- Money is integer minor units only. Decimal strings and RevenueCat floats go through a string-based parser with a currency exponent table.
- Tests generate real signatures with test secrets (HMAC for Stripe, Paddle, RevenueCat; RSA keypair plus self-signed cert for PayPal) and cover tampered body, stale timestamp, wrong secret, and rotated multi-signature headers.

## Hosting and free-tier research (PAYSCOPE-13)

Researched 2026-10-13.
Dates are page "last updated" values or fetch dates.
Items marked unverified could not be confirmed from a primary source.

### Vercel Hobby

Sources: https://vercel.com/docs/plans/hobby (2026-09-14), https://vercel.com/docs/cron-jobs/usage-and-pricing (2026-07-15)

- Free, no billing cycle.
- Function max duration 300s; 1M invocations, 4 CPU-hrs active CPU, 100 GB fast data transfer included.
- Non-commercial, personal use only (a portfolio demo fits).
- Cron: minimum interval once per day with ±59 min precision, so it cannot drive a worker.
- Serverless functions cannot host a long-running poller.

### Container and worker hosts

| Host | Free without card? | Idle behavior | Long-running worker? | Source |
|---|---|---|---|---|
| Railway | Free plan $1 credit/month; 30-day trial $5 credit, no card. Free-plan card requirement unverified. | No sleep | Credit runs out in days | https://railway.com/pricing |
| Render | Free Web Service, 750 instance hours/month. Card requirement unverified. | Spins down after 15 min without inbound HTTP, ~1 min wake | Background Worker type not free; web service can run an in-process worker while awake | https://render.com/docs/free |
| Fly.io | No free tier for new orgs | n/a | Ruled out | https://docs.fly.io/about/pricing |
| Koyeb | Conflicting reports after acquisition; unverified | Scale to zero | Ruled out | https://www.koyeb.com/pricing |
| Northflank | Sandbox free but payment method required | Always on (unverified) | Ruled out (card) | https://northflank.com/docs/v1/application/billing/cloud-provider-billing |

No credible card-free, always-on container host exists today.

### Supabase Free

Sources: https://supabase.com/pricing, https://supabase.com/docs/guides/platform/going-into-prod, https://supabase.com/docs/guides/platform/compute-and-disk

- 500 MB database, 50,000 MAU, 5 GB egress plus 5 GB cached egress, 2 active projects.
- Free projects with low activity over 7 days may be paused; restore from the dashboard.
- Nano compute: 60 direct and 200 pooler clients (free-plan mapping unverified).
- pg_cron can make HTTP requests via pg_net; free-plan availability unverified, check `pg_available_extensions`.
- Direct connections are IPv6 only without the IPv4 add-on; use the pooler from IPv4 hosts (unverified).

### Worker strategies at $0

1. Worker loop inside the API process, claiming jobs with `FOR UPDATE SKIP LOCKED`.
2. Same loop, also kicked on enqueue and by a secret-protected `/internal/tick` endpoint, so a sleeping host still drains the queue when woken.
3. Supabase pg_cron plus pg_net calling `/internal/tick` every 1 to 5 minutes.
4. GitHub Actions scheduled workflow curling `/internal/tick` as a backup keep-alive (5 min minimum, best effort; unverified).

### Recommendation

| Component | Choice | Why |
|---|---|---|
| web | Vercel Hobby | Free, non-commercial demo |
| api + worker | One Fastify process on Render Free, worker started in-process | Free, tolerates sleep |
| tick / keep-alive | pg_cron + pg_net to `/internal/tick`, GitHub Actions cron as backup | Wakes API, drains queue, keeps Supabase active |
| database | Supabase Free | Fits 500 MB |
| local / demo recording | `pnpm dev` with live worker | Always on |

### Decisions

- Do not use Vercel cron for the worker.
- Worker is a module the API process starts; it stays importable so it can run as its own process later.
- All job claiming uses `FOR UPDATE SKIP LOCKED`, so multiple workers are safe.
- Expose a secret-protected `/internal/tick` that runs one drain pass.
- Keep Supabase active with a pg_cron heartbeat, with the GitHub Actions ping as redundancy.
- Document the ~60s cold start after Render sleep in the README.
