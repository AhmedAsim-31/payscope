# PayScope — Complete Product, Architecture & Engineering Handoff

## 1. Role and objective

Act as the autonomous lead engineer, product engineer, backend architect, security engineer, and QA engineer for **PayScope**.

Build a polished, credible portfolio-grade product demonstrating complex payment integrations, resilient backend systems, webhook processing, reconciliation, subscription state management, and production-minded security.

**Do not stop after writing a plan.** Inspect the repository, research official documentation, make decisions, implement the application, run tests, fix failures, and document results. Work in phases so the project remains functional throughout.

At the beginning:
1. Inspect the repository, tools, dependencies, and current implementation.
2. Identify existing code worth preserving.
3. Research current official documentation for the stack and provider APIs.
4. Write a concise implementation plan and prioritized checklist.
5. Begin implementation immediately after assessment.
6. Maintain `IMPLEMENTATION_STATUS.md` with completed work, current phase, test results, known issues, and next concrete actions.

If context limits interrupt work, update the status file before stopping. On resumption, read it and continue from the next incomplete task. Do not repeatedly re-plan completed work. Make sensible decisions autonomously; ask only when a genuinely blocking issue cannot be resolved safely.

---

## 2. Product definition

**Name:** PayScope  
**Category:** Payment operations, webhook reliability, reconciliation, and subscription-entitlement consistency.

**Target customers:** Small and mid-sized SaaS companies, subscription businesses, and mobile-app businesses integrating payment or subscription providers.

**Problem:** Payment integrations become difficult to operate when events are duplicated, delayed, reordered, rejected, or only partially processed. Examples include successful payments without access grants, expired subscriptions with active entitlements, refunds missing from internal records, duplicate webhook side effects, stale events overwriting newer state, repeated background-job failures, and provider state differing from local records.

**Product promise:** “Understand what happened, identify what is inconsistent, and resolve payment-integration failures safely.”

PayScope is not a payment gateway, full accounting system, or generic analytics dashboard. Its core value is operational visibility and reliable recovery.

**Core workflow**
1. Connect or select a provider.
2. Inspect payments, subscriptions, customers, and entitlements.
3. Examine webhook events and processing attempts.
4. Identify failures and inconsistencies.
5. Investigate the timeline and evidence.
6. Reconcile internal records against authoritative provider state where supported.
7. Perform a safe, auditable recovery action.
8. Verify the resulting state.

Build this as a cohesive product, not unrelated CRUD pages.

---

## 3. Non-negotiable constraints

### Cost
The project must be buildable and demonstrable with **$0 required spend**.
- Use free tiers and local development.
- No paid APIs, services, AI services, infrastructure, or test accounts.
- No paid maps, email, SMS, analytics, Redis, or queue services.
- Use provider sandbox/test environments.
- Seed realistic fictional data.
- Never make real payments or perform real financial operations.
- Local development must not require a credit card.
- Verify current free-plan restrictions before depending on a service.

Free services may sleep, pause, impose quotas, or have cold starts. Document limitations honestly; do not promise production uptime on a free deployment.

### Technology
- Do not use Cloudflare Workers or Hono.
- Do not recreate the FieldFlow stack.
- Use Next.js, Node.js LTS, Fastify, Supabase PostgreSQL, and Drizzle ORM.
- Avoid unnecessary services and architectural complexity.
- No paid external queue or cache.
- Never use floating-point arithmetic for money.
- Never expose secrets or privileged database credentials to the browser.
- Never claim an integration works unless implemented and verified.

### Intellectual property and honesty
This is an independent portfolio project.
- Do not copy employer code, private architecture, proprietary data, or internal documentation.
- Use fictional businesses, customers, payments, and events.
- Do not represent simulated events as genuine provider events.
- Do not claim an unconfigured provider is connected.
- Do not claim production readiness, provider parity, or verified external behavior without evidence.
- Label demo, sandbox, and provider-derived data distinctly.

---

## 4. Official-documentation research

Before finalizing implementation details, research current official documentation for:
- Next.js and Node.js LTS.
- Fastify plugins, hooks, validation, and error handling.
- Supabase PostgreSQL, Auth, Row Level Security (RLS), migrations, connection pooling, and free-plan limits.
- Drizzle ORM for PostgreSQL, migrations, transactions, and query construction.
- Zod.
- Stripe test mode, webhook signatures/delivery, idempotency, subscriptions, refunds, and test clocks.
- PayPal sandbox, orders, captures, refunds, and webhook verification.
- Paddle sandbox, transactions, subscriptions, and webhook signatures.
- RevenueCat Test Store, entitlements, subscription events, and webhook behavior.
- Official documentation for chosen free hosting.

Official documentation takes priority over community articles.

Create `docs/provider-research.md` with official URLs, sandbox requirements, authentication/signature verification, supported API operations, documented rate limits/retry behavior, free-plan restrictions, unverified capabilities, and design decisions.

Verify whether RevenueCat's current plan permits the webhook functionality required. Do not depend on a paid feature. If a capability requires unavailable credentials or paid access, document the limitation and provide a useful local simulation instead of fabricating success.

---

## 5. Required stack and repository structure

### Frontend
- Next.js + TypeScript.
- Tailwind CSS.
- Accessible component system; shadcn/ui is acceptable.
- TanStack Query where useful.
- React Hook Form and Zod for complex forms where useful.
- Responsive desktop/tablet/mobile layouts.
- Meaningful loading, empty, success, and error states.

### Backend
- Node.js LTS.
- Fastify + TypeScript.
- Zod-based request validation.
- Explicit authentication and authorization.
- Structured logging and centralized error handling.

### Database
- Supabase-managed PostgreSQL.
- Drizzle ORM.
- Version-controlled migrations.
- Database constraints for business invariants.
- RLS where appropriate.
- Explicit server-side tenant/resource authorization even with RLS enabled.

Supabase privileged service-role/secret keys stay server-side only. Such credentials can bypass RLS and must never be bundled into browser code.

### Monorepo
Use pnpm with shared contracts, provider abstractions, and test utilities. Suggested structure:

```text
apps/
  web/
  api/
packages/
  shared/
  provider-adapters/
  test-utils/
supabase/
  migrations/
  tests/
docs/
docker-compose.yml
pnpm-workspace.yaml
package.json
IMPLEMENTATION_STATUS.md
README.md
```

Adapt if the existing repository provides a strong reason, preserving architectural boundaries.

### Testing
- Vitest for unit/integration tests.
- Playwright for end-to-end browser tests.
- Supabase CLI for local database workflows where practical.
- PostgreSQL-backed tests for transactional/concurrency behavior.
- CI checks for lint, types, migrations, and tests.
- Prefer deterministic local tests over external-provider-dependent tests.

---

## 6. Application architecture

Keep clear boundaries between web, API, database, provider adapters, and asynchronous processing.

```text
Browser
   |
   v
Next.js application
   |
   v
Fastify API
   +---- Authentication and authorization
   +---- Domain services
   |        +---- PostgreSQL through Drizzle
   |        +---- Provider adapters
   |        +---- Reconciliation engine
   |        +---- Audit and incident services
   +---- Verified webhook ingress
                 |
                 v
          Durable event storage
                 |
                 v
        PostgreSQL-backed jobs
                 |
                 v
          Background worker
```

Do not run full reconciliation synchronously inside webhook handlers. Use transactions and constraints for local invariants; keep external requests outside long-running DB transactions.

### Background jobs
Use a PostgreSQL-backed job table and worker process, not Redis or a paid queue. Support:
- Durable job creation.
- Bounded retries with exponential backoff and jitter.
- Maximum attempt counts.
- Safe claiming/leasing.
- Lease expiry and crash recovery.
- Idempotent processing.
- Dead-letter/needs-attention states.
- Queue visibility and failure diagnostics.
- Bounded concurrency.
- Safe duplicate execution.

Use atomic DB operations, appropriate locking, or `FOR UPDATE SKIP LOCKED` where suitable. Never assume a job executes exactly once.

---

## 7. Provider integrations

Implement four adapters with deliberately defined, documented scopes.

### Stripe
Support relevant sandbox workflows for payments, subscriptions, refund events, webhook verification, deduplication, subscription lifecycle, authoritative state reads where supported, and safe reconciliation. Use test mode only.

### PayPal
Support relevant sandbox workflows for orders/captures, payment outcomes, refund events, webhook verification, deduplication, authoritative state reads where supported, and reconciliation.

### Paddle
Support relevant sandbox workflows for transactions, subscription lifecycle, refund-related events where supported, signature verification, deduplication, state synchronization, and reconciliation where supported.

### RevenueCat
Support relevant test workflows for customers/app-user identifiers, subscription lifecycle, entitlement activation/expiration, webhook verification, deduplication, and entitlement reconciliation where supported. Use Test Store or clearly labeled local simulation when the required external feature is unavailable for free.

### Adapter design
A consistent internal interface should cover, where applicable:
- Credential validation.
- Webhook signature verification.
- Event normalization and provider-specific identity.
- Fetching authoritative payment/subscription state.
- Mapping external identifiers to internal records.
- Supported reconciliation operations.
- Capability declarations.
- Provider-specific error normalization.

Do not force providers with different semantics into an identical model. Explicitly distinguish:
1. Supported and tested.
2. Implemented but unverified.
3. Unsupported.
4. Simulated.

Without credentials, the application remains useful via seeded data and local scenarios. Provider connection status must be honest.

### External side effects
Version one must not initiate real financial operations. Do not issue real refunds, captures, charges, or cancellations. Any sandbox operation must have explicit safety boundaries and tests. Prefer safe local corrections and sandbox-only verification.

---

## 8. Product modules and UI

Build a polished B2B operations interface with persistent organization context, navigation, clear titles, and cross-links.

### A. Overview dashboard
Show payment volume/counts for a selected period, successful/failed/pending payments, subscription counts by status, active entitlements, webhook success/failure rates, pending/failed jobs, open incidents, unresolved reconciliation findings, and recent activity.

Metrics must derive from records or be clearly labeled sample values—not hardcoded numbers presented as live data. Do not aggregate different currencies without a documented FX source and conversion timestamp; prefer per-currency breakdowns.

### B. Payments
Search/filter by provider, status, currency, amount, and date; payment details; customer/subscription links; associated events and processing history; refunds; audit history. A payment amount is not automatically settlement or net payout.

### C. Subscriptions
Filter by status/provider; customer details; period/lifecycle timestamps; cancellation, expiration, renewal when supported; related payments/events; entitlement relationships; reconciliation status. Do not assume providers share identical semantics.

### D. Customers
Searchable list; provider customer IDs; internal/provider mappings; related payments, subscriptions, entitlements, events, and audit timeline.

### E. Entitlements
List/detail pages; active, expired, revoked, and inconsistent states; source relationships where known; grant/expiration/revocation times; reconciliation status; confirmed, audited recovery actions.

PayScope cannot automatically inspect an arbitrary customer's private application DB. Entitlements must come from a documented ingestion API, explicit integration, or local scenario simulator. Disclose each record's source.

### F. Webhook/event inbox
List provider, event type/time, receipt time, status, attempt count; filter failed/pending/processed/duplicate/needs-attention; redacted payload view; processing timeline; retry history; failure details; related entities; safe retry when allowed. Never expose secrets or sensitive customer data.

### G. Processing attempts
Track attempt number, start/end timestamps, outcome, failure category, sanitized errors, retry eligibility, next retry time, and correlation/trace ID.

### H. Reconciliation
Manual/scheduled runs, run history/status, records examined, matches, mismatches, unavailable provider records, failed checks, unresolved findings, and comparisons against provider state where supported. Each finding explains discrepancy, evidence, severity, and next step.

### I. Incidents
List/status/severity/category; related provider/customer/payment/subscription/event; timestamps; action timeline; resolution notes; links to findings. Deduplicate incidents for the same unresolved problem.

### J. Safe repair center
Support carefully scoped operations: retry a failed job, idempotently reprocess a stored verified event, refresh local state from verified provider state, correct an entitlement when evidence/policy permits, or mark a finding reviewed/resolved with explanation. Confirm consequential actions and record actor, reason, target, previous/resulting state, and outcome. No blind DB edits or irreversible provider actions.

### K. Scenario lab
Provide deterministic scenarios:
1. Successful payment.
2. Failed payment.
3. Subscription lifecycle transition.
4. Refund/reversal.
5. Duplicate webhook.
6. Out-of-order webhook.
7. Provider API failure.
8. Processing failure.
9. Successful payment with inactive entitlement.
10. Expired subscription with active entitlement.
11. Invalid webhook signature.
12. Cross-tenant access attempt.
13. Retry exhaustion/dead-letter handling.
14. Reconciliation mismatch.
15. Successful recovery after simulated failure.
16. Concurrent duplicate processing.
17. Worker crash/expired lease recovery.

Each scenario states what it simulates, records changed, expected outcome, evidence, and whether it is local simulation or provider sandbox. Scenarios must be repeatable, isolated, safe to rerun, and resettable.

### L. Provider connections
Show provider, connection status, sandbox/simulation mode, last verification, supported capabilities, credential status, last sanitized error, and setup instructions. Never reveal full credentials.

### M. Audit history
Search/filter important operational actions and inspect details. Generate audit events server-side; ordinary users cannot edit them.

---

## 9. Data model and integrity

At minimum, model:
- `organizations`
- `profiles`
- `memberships`
- `provider_connections`
- `customers`
- `provider_customer_mappings`
- `payment_records`
- `subscription_records`
- `entitlement_records`
- `provider_events`
- `event_processing_attempts`
- `reconciliation_runs`
- `reconciliation_findings`
- `incidents`
- `incident_actions`
- `audit_logs`
- `idempotency_records`
- `background_jobs`
- `demo_scenarios`
- `demo_scenario_runs`

Add other tables only when justified.

Requirements:
- Every tenant-owned record has an organization relationship.
- Provider IDs are scoped to the correct provider connection/account.
- Enforce deduplication and invariants with DB uniqueness constraints.
- Use foreign keys and intentional deletion behavior.
- Prevent duplicate provider events within the correct provider/account scope.
- Store money as integer minor units where provider semantics allow, with explicit currency; use precise numeric types otherwise.
- Never use JS floating-point arithmetic for money.
- Preserve provider event time separately from receipt, processing, and local update times.
- Limit and retain raw payloads only when justified.
- Normalize commonly queried fields; use JSONB selectively.
- Minimize personal data and do not silently erase important operational history.
- Use optimistic concurrency, version checks, or locking where simultaneous updates could corrupt state.

---

## 10. Webhook ingestion and event reliability

This is a core differentiator. Build a real reliability system, not webhook CRUD.

### Ingress
For each supported provider:
1. Enforce request body limits.
2. Preserve the exact raw body when signature verification requires it.
3. Verify signatures using official methods.
4. Reject invalid signatures without creating trusted processing work.
5. Identify provider account and event identity correctly.
6. Validate required headers and structure.
7. Persist durably before returning success.
8. Deduplicate with DB-enforced uniqueness.
9. Enqueue processing transactionally or through a reliable durable pattern.
10. Return provider-compatible responses.

Never acknowledge acceptance before durable storage. Handle duplicate deliveries according to provider expectations without duplicate side effects.

### Processing
- Normalize events and validate relationships/tenant ownership.
- Apply valid transitions and safely ignore stale events.
- Prevent duplicate side effects.
- Record every attempt.
- Retry only where appropriate, with bounded exponential backoff and jitter.
- Stop at configured maximum attempts.
- Mark terminal failures for investigation.
- Emit sanitized diagnostics and preserve a clear timeline.

### Ordering
Never assume webhooks arrive chronologically. Use reliable sequence/version data where available; otherwise use provider semantics, timestamps where appropriate, and authoritative fetches to prevent stale events overwriting newer state. Document where ordering cannot be guaranteed.

### Idempotency
Implement at the right boundaries: ingestion, job creation, processing, transitions, scenario execution, reconciliation actions, repair operations, and supported sandbox API operations. A unique event ID alone does not make downstream effects idempotent. Protect against retries and concurrent execution.

Distinguish transient/permanent errors, invalid input, provider auth failures, unsupported events, and state conflicts. Do not endlessly retry permanent errors or repeat a financial side effect when the previous outcome is unknown.

---

## 11. Reconciliation engine

Implement a reusable framework:
1. Select provider connection and scope.
2. Identify local records.
3. Fetch authoritative state where supported.
4. Normalize comparable fields.
5. Compare local/external state.
6. Classify discrepancies.
7. Create/update findings idempotently.
8. Record evidence and timestamps.
9. Recommend next steps.
10. Resolve only after required verification succeeds.

Example findings: provider payment missing locally; status mismatch; inconsistent refund; externally expired subscription still active locally; missing/stale entitlement; provider object not found; temporary provider unavailability; missing/ambiguous identifier mapping.

Provider API unavailability is not proof an object does not exist.

Safety requirements:
- Detection and correction are separate.
- No silent destructive repairs.
- External requests outside DB transactions.
- Bounded API concurrency/request volume; respect provider limits.
- Resumable runs/checkpoints where useful.
- Record partial failures accurately.
- Prevent overlapping runs from producing duplicate findings or conflicting updates.
- Local deterministic reconciliation must work without provider credentials.

---

## 12. Rate limiting — mandatory

Implement endpoint-specific rate limiting using Fastify-compatible middleware/plugins. Do not use one global limit.

Define suitable limits for:
- Login/auth endpoints.
- Credential verification and connection testing.
- Public webhook ingress.
- Reconciliation.
- Scenario execution/reset.
- Job retries and repairs.
- Search/filter/export.
- Public demo access.
- Expensive provider API calls.

Make limits configurable and document rationale.

Requirements:
- Return `429 Too Many Requests` and meaningful `Retry-After` where appropriate.
- Bound concurrent expensive operations.
- Prevent unlimited job enqueueing.
- Use trusted identity for authenticated limits.
- Apply unauthenticated limits.
- Configure trusted proxies explicitly.
- Never trust arbitrary client-supplied forwarding headers.
- Do not rely only on a client-supplied organization ID.
- Rate limiting must not bypass auth or tenant authorization.

If multiple API instances are supported, do not rely solely on an in-process limiter. Use a shared zero-cost-compatible store such as PostgreSQL where distributed enforcement is required, while preventing the limiter from becoming an unbounded DB bottleneck. A documented single-instance development limiter is acceptable only if its scope and limitations are explicit.

Webhook considerations: provider retries are normal; accepted events must not be lost. Verify signatures, deduplicate, avoid expensive work on duplicate deliveries, bound size/concurrency, return compatible status codes, and document overload behavior.

Test thresholds/reset, `429`/retry headers, authenticated/unauthenticated paths, spoofed proxy headers, multi-instance consistency if claimed, concurrent expensive-operation limits, duplicate webhook behavior, and ensure accepted events/jobs are not silently lost.

---

## 13. Database indexing — mandatory

Design indexes from actual query patterns. List major queries for each screen and workflow before finalizing schema.

Evaluate index candidates for:
- Memberships by organization/user.
- Provider connections by organization/provider.
- Customer mappings by connection/external ID.
- Payments by organization, connection, status, and creation time.
- Subscriptions by organization/status/customer/provider.
- Entitlements by organization/customer/status/expiration.
- Events by connection/provider event ID/status/receipt time.
- Attempts by event and attempt time.
- Jobs by status/availability/lease state.
- Reconciliation runs by organization/start time.
- Findings by run/status/severity/creation time.
- Incidents by organization/status/severity/update time.
- Audit logs by organization/time/actor/target.
- Idempotency records by actual scope/key.
- Scenario runs by organization/scenario/time.

These are candidates, not instructions to create every index.

Rules:
- Use unique indexes/constraints for invariants.
- Match composite index order to equality filters, range filters, and sorting.
- Index foreign-key access patterns where useful.
- Consider partial indexes for pending jobs/unresolved findings.
- Avoid redundant indexes and account for write/storage overhead.
- Do not index every column blindly.
- Support pagination/sorting and tenant-scoped queries.

Seed realistic data and inspect important queries with `EXPLAIN`; use `EXPLAIN ANALYZE` on safe representative queries in controlled local/test environments. Document key queries, chosen indexes and rationale, plans examined, bottlenecks, optimizations, and limits of small datasets. Do not claim performance gains without evidence.

---

## 14. Caching — mandatory, selective

Caching reduces repeated work; it does not replace proper queries, indexes, or integrity. Optimize and measure DB queries first.

Possible candidates:
- Dashboard aggregates.
- Provider capability metadata.
- Stable non-secret configuration.
- Reconciliation summaries.
- Expensive derived statistics.

Never use potentially stale cache as authority for authorization/membership, webhook dedupe, idempotency, payment/subscription transitions, entitlement grants/revocations, repair eligibility, or secrets.

For every cache document what is cached, key structure, tenant scope, TTL, invalidation, failure behavior, consistency, and measurement. Include tenant scope in keys. Use short TTLs for mutable summaries and invalidate after writes where practical. Prevent stampedes for expensive aggregates.

A bounded in-process cache is fine for safe stable data, but is not distributed/global. Set HTTP caching headers deliberately; authenticated/tenant-sensitive responses must not become publicly cacheable.

Test tenant-scoped keys, expiration, invalidation, safe fallback, no stale authorization/financial decisions, and multi-instance behavior. If caching provides no meaningful benefit for a query, document why it was omitted rather than adding infrastructure.

---

## 15. Database optimization and performance — mandatory

### Query efficiency
- Select only required columns; avoid `SELECT *` for large/sensitive records.
- Eliminate N+1 queries.
- Use joins or bounded batches.
- Use SQL aggregates for dashboard metrics.
- Never load entire tables into app memory for summaries.
- Bound every list endpoint and filter/date range.
- Use stable cursor pagination for large/changing histories; offset only where appropriate.
- Avoid unnecessary provider API calls.
- Bound provider batches, promises, worker concurrency, and reconciliation volume.

### Transactions and concurrency
- Keep transactions short.
- Never hold DB locks while awaiting provider HTTP requests.
- Use atomic updates or optimistic concurrency for transitions.
- Prevent unsafe duplicate worker processing.
- Use unique constraints to protect against races.
- Make retries/crash recovery safe.
- Avoid long reconciliation transactions.
- Define clear boundaries for event persistence and job creation.

### Schema and storage
- Use appropriate timestamp types/timezone semantics.
- Use integer minor units or precise numeric values for money.
- Use JSONB judiciously, not instead of relational modeling.
- Keep frequently filtered/joined fields typed.
- Define foreign keys/delete behavior intentionally.
- Limit raw payload size and retention.
- Use version-controlled reversible migrations.
- Do not manually alter production schema without migrations.

### Connection management
Research Supabase's correct connection strategy for each runtime/driver:
- Use compatible pooling/Supabase-supported approaches.
- Configure pool sizes/timeouts.
- Do not open a new connection per request.
- Respect free-tier connection limits.
- Document local, CI, and hosted differences.
- Handle transient DB failures safely.
- Never leak connection strings.

### Observability
Provide sanitized signals for API latency/errors, slow queries where observable, webhook latency, queue depth/oldest job, retries/terminal failures, reconciliation duration/failures, DB/worker health, and cache metrics if applicable. No paid observability service is required.

### Verification
Benchmark representative workflows with realistic seed data: dashboard, payments, subscriptions, event inbox/detail, findings, job claiming, audit history, concurrent duplicate events, and concurrent scenarios. Set targets after measuring; report actual observations. Avoid stress tests that exhaust free quotas.

Create `docs/backend-performance.md` covering queries, indexes, caching, connection management, measurements, and known bottlenecks.

---

## 16. Authentication, authorization, and multi-tenancy

Roles:
- `OWNER`
- `ADMIN`
- `OPERATOR`
- `VIEWER`

Define a documented permission matrix. Suggested principles:
- OWNER manages ownership and critical organization settings.
- ADMIN manages members, provider connections, and operational configuration.
- OPERATOR investigates events, runs reconciliation, and performs permitted recovery.
- VIEWER can inspect authorized records but cannot mutate.

Prevent removal/demotion of the last owner. Ownership transfer must be deliberate and audited.

For every protected request:
- Verify authenticated user.
- Verify organization membership for tenant-scoped requests.
- Verify role for each mutation.
- Verify resource ownership and provider connection scope.
- Never trust client-provided organization ID as authorization.
- Prevent cross-tenant reads, writes, exports, and indirect access.
- Apply checks to nested resources, retries, reconciliation, and repairs.
- Enforce server-side authorization even if the UI hides actions.

Implement RLS on relevant tables where appropriate, plus explicit server-side authorization. Test direct API requests, manipulated identifiers, and cross-tenant access.

Use Supabase Auth with server-side token verification in Fastify. Research the right session/token approach for Next.js and API. Never trust unsigned/unverified claims. Avoid logging tokens; handle expiration and sign-out correctly.

---

## 17. Security requirements

### Application/request security
- Validate all inputs at API boundaries: path, query, body, relevant headers.
- Enforce body limits.
- Use Drizzle/parameterized SQL safely.
- Prevent mass assignment with explicit writable fields.
- Return consistent safe errors; do not expose stack traces/secrets.
- Configure security headers and strict CORS allowlists.
- Implement CSRF protection if the cookie-based flow requires it.
- Use secure cookie settings.
- Avoid open redirects.
- Prevent IDOR through authorization.
- Bound search, exports, date ranges, and expensive requests.
- Rate-limit sensitive endpoints.

### Webhooks
- Use official signature algorithms and exact raw body when required.
- Use appropriate constant-time comparison when implementing it yourself.
- Validate timestamps/replay protection per provider.
- Enforce payload limits.
- Do not trust identifiers before verification.
- Deduplicate accepted events.
- Redact sensitive payload fields in logs/UI.
- Unverified payloads must never trigger processing jobs.

### Secrets/provider connections
- Never commit credentials; provide placeholder-only `.env.example`.
- Keep secrets server-side and redact them from logs.
- Encrypt retrievable credentials at rest if stored.
- Minimize stored credential material.
- Document key management and limitations.
- Never claim plaintext is encrypted.
- Fail safely if an encryption key is missing.
- Support rotation/removal where practical.

### SSRF/outbound requests
- Use fixed trusted provider base URLs.
- Never accept arbitrary webhook verification/reconciliation URLs.
- Restrict redirects where relevant.
- Validate configurable hosts.
- Block user-controlled requests to loopback, private networks, and metadata endpoints.
- Apply timeouts and response-size limits.
- Never leak credentials across redirects/hosts.

### Audit and retention
Audit membership/role changes, provider connection changes, credential rotation/removal, reconciliation, repairs, retries, entitlement corrections, incident resolution, and relevant scenario resets. Record actor, organization, action, target, timestamp, reason, and outcome where appropriate.

Never log passwords, full credentials, authorization headers, or unnecessary personal data. Audit logs must not be editable by ordinary users. Define retention/deletion policies for raw payloads, jobs, scenarios, and audit logs.

Create `docs/security.md` describing threat model, mitigations, residual risks, secret handling, tenant isolation, and known limitations.

---

## 18. API design

Use versioned REST endpoints under `/api/v1`, with consistent response/error shapes, status codes, validation errors, authentication/authorization errors, rate-limit responses, and server errors.

Potential route groups:
- `/auth`
- `/organizations`
- `/memberships`
- `/providers`
- `/customers`
- `/payments`
- `/subscriptions`
- `/entitlements`
- `/webhooks`
- `/events`
- `/jobs`
- `/reconciliation`
- `/findings`
- `/incidents`
- `/repairs`
- `/scenarios`
- `/audit`

Only create endpoints that support real workflows.

Requirements:
- Validate inputs and responses where practical.
- Paginate lists with maximum page sizes and sensible filter bounds.
- Enforce tenant scope in every repository/service query.
- Return correlation IDs.
- Avoid internal exception details.
- Document API/setup.
- Use idempotency keys for appropriate mutations.
- Make retries, repairs, and scenarios safe under repeated requests.

---

## 19. Testing requirements

### Unit tests
Cover event normalization, signature verification fixtures/test vectors, state transitions, dedupe, out-of-order events, idempotency, reconciliation comparisons/finding classification, entitlement calculations, retry/backoff, permissions, money/currency, and cache invalidation where applicable.

### Integration tests
Use real test PostgreSQL where DB behavior matters. Cover clean migrations, tenant queries, RLS where configured, transactional event/job persistence, concurrent uniqueness, duplicate webhooks, job claiming/lease recovery, retry exhaustion, reconciliation, audit, rate limiting, credential redaction/encryption, constraints, and deletion behavior.

Do not mock the database for all tests. Critical uniqueness, locking, and transaction guarantees require DB-backed tests.

### Security regression tests
Cross-tenant reads/writes, unauthorized roles, manipulated IDs, invalid signatures, oversized payloads, spoofed proxy headers, rate-limit bypass, secret leakage, idempotency-key reuse, repeated repairs, unauthorized exports, SSRF protection if relevant, and cache leakage.

### Playwright end-to-end tests
1. User signs in.
2. User selects/enters an organization.
3. Overview shows seeded data.
4. User opens payment and related events.
5. User inspects failed webhook.
6. User runs a scenario.
7. Scenario creates expected records.
8. Reconciliation identifies a mismatch.
9. Authorized recovery resolves it.
10. Audit history records it.
11. Viewer cannot perform restricted mutation.
12. Another tenant cannot access the record.

Tests must be repeatable; avoid arbitrary sleeps; use controlled clocks where useful; clean scenario data; never require real payment credentials in CI; document sandbox-only tests. Fix failures rather than weakening assertions.

---

## 20. Demo data and onboarding

The demo must work without provider credentials. Seed fictional organizations, customers, providers, subscriptions, payments, events, attempts, incidents, and findings—enough connected data to feel real without being huge.

Include successful/failed payments, active/expired/canceled/past-due subscriptions where supported, active/inconsistent entitlements, duplicate/out-of-order events, failed jobs, findings, incident timelines, audit history, and clearly labeled demo/sandbox provider connections.

Provide a guided scenario:

**“Payment succeeded, but access was not granted.”**

Reviewer can:
1. Open the payment.
2. Follow webhook/processing history.
3. See entitlement inconsistency.
4. Run reconciliation.
5. Inspect finding.
6. Apply permitted local recovery.
7. Confirm final state.
8. View audit trail.

This should demonstrate the product's value end to end.

---

## 21. Deployment and zero-cost operation

### Local development
Document Node/pnpm versions, `.env.example`, Docker Compose where useful, PostgreSQL setup, Supabase CLI if appropriate, migration/seed commands, separate web/API/worker commands, tests, and troubleshooting.

Local development must not require provider credentials. A local PostgreSQL fallback is acceptable for CI/development; document how it relates to Supabase.

### Optional public demo
Verify current free-tier limits and compatibility before choosing hosting. Do not assume every service remains free or supports a background worker.

Requirements:
- No mandatory paid add-ons.
- No production financial credentials.
- Isolated demo data and restricted permissions.
- No shared privileged account.
- No public privileged admin actions.
- No unbounded scenario execution.
- No secrets in build artifacts.
- Clear demo/sandbox labels.
- Honest sleep/cold-start/quota disclosures.

If free hosting cannot reliably run the worker/integrations, provide a working local demo and explain the limitation. Do not introduce paid infrastructure silently.

---

## 22. UI and portfolio quality

The app must look like a credible B2B product, not a tutorial or generic admin template.

Use clear hierarchy, consistent spacing/typography, restrained colors, readable status indicators, quality tables/detail panels, meaningful timelines, thoughtful empty states, search/filtering, accessible contrast/keyboard navigation, responsive layouts, consistent loading/error handling, and confirmation dialogs.

Avoid excessive gradients, random decorative cards, meaningless charts, fake live activity, and unnecessary animation.

Every visible button must work or be disabled with an explanation. Avoid dead links and placeholder actions on the main demo path. Metrics must match records. Never fake provider connection success. Label simulation. Include useful failure messages/recovery guidance. A reviewer should understand the problem and product value within one minute.

---

## 23. Documentation deliverables

Create and maintain:
- `README.md` — overview, screenshots if available, setup, walkthrough, architecture, limitations.
- `IMPLEMENTATION_STATUS.md` — phases, completed work, tests, blockers, next actions.
- `docs/architecture.md` — architecture and decisions.
- `docs/provider-research.md` — official sources/capabilities.
- `docs/database.md` — schema, relations, constraints, indexes, migrations.
- `docs/backend-performance.md` — query strategy, indexes, caching, connections, measurements.
- `docs/security.md` — threat model, authorization, webhooks, secrets, residual risks.
- `docs/api.md` — endpoints and conventions.
- `docs/demo.md` — demo setup, scenarios, reset, simulated vs real behavior.
- `docs/deployment.md` — deployment, env vars, free-tier limits, troubleshooting.
- `docs/operations.md` — workers, retries, queue recovery, reconciliation, diagnostics.

Never document a feature as implemented unless it actually is.

---

## 24. Phased implementation plan

### Phase 0 — Assessment
Inspect repository/tooling, research official docs, verify free-tier constraints, identify integration limitations, establish milestones, and update `IMPLEMENTATION_STATUS.md`. Then proceed directly.

### Phase 1 — Foundation
Initialize/clean monorepo; configure TypeScript/lint/format/shared contracts; set up Next.js/Fastify/PostgreSQL/Drizzle; create migrations; configure Supabase Auth; implement organization/membership/authorization foundations; add health/readiness checks, CI, and smoke tests.

### Phase 2 — Product shell/demo
Build navigation/design system; implement overview, payments, subscriptions, customers, events, incidents; add seeded data; make main investigation workflow navigable without credentials.

### Phase 3 — Reliability engine
Implement durable webhook ingress, provider verification interfaces, dedupe, PostgreSQL jobs, safe claiming/leases, retries/backoff/attempt history/dead-letter handling, idempotent processing/transitions, and DB-backed concurrency tests.

### Phase 4 — Reconciliation/recovery
Implement normalized adapters and local reconciliation; findings/incidents; safe repairs; audit; verify full mismatch-and-recovery scenario.

### Phase 5 — Provider adapters
For Stripe, PayPal, Paddle, RevenueCat: verify docs; declare capabilities; implement credential handling, signature verification, normalization, supported API reads, reconciliation, fixtures/unit tests, optional sandbox tests, and limitations. Do not sacrifice correctness to claim four complete integrations.

### Phase 6 — Rate limiting/performance
Implement endpoint-specific limits and validate distributed enforcement where applicable; review queries; add justified indexes; inspect plans; optimize dashboard/list queries; cursor pagination where needed; bound worker/provider concurrency; add selective caching only when justified; validate connection pools; measure workflows; write `docs/backend-performance.md`.

### Phase 7 — Security/reliability hardening
Complete tenant tests, verify RLS/server authorization, audit mutations, verify redaction/encryption, review CSRF/CORS/headers/limits, test malformed/oversized webhooks, retries/crashes/concurrency, and retention/exports. Fix issues.

### Phase 8 — UI/E2E verification
Polish loading/empty/error states; verify actions; complete scenario lab; add Playwright; test desktop/mobile; run clean migrations, lint, types, unit/integration/E2E tests; fix regressions.

### Phase 9 — Portfolio packaging
Finish docs; prepare demo dataset and reset instructions; add diagrams if useful; capture genuine screenshots from running app; verify walkthrough from clean setup; document limitations; make it easy for technical reviewers and clients to understand.

---

## 25. Definition of done

Do not declare complete until these are satisfied or limitations are explicitly documented.

### Functionality
- [ ] App starts from documented instructions.
- [ ] Clean database can be migrated and seeded.
- [ ] Demo works without provider credentials.
- [ ] Main screens display actual stored data.
- [ ] Scenario lab reproduces payment/entitlement inconsistency.
- [ ] Webhook events persist before acknowledgement.
- [ ] Duplicate events cause no duplicate side effects.
- [ ] Failed jobs can be inspected and safely retried.
- [ ] Reconciliation identifies seeded inconsistencies.
- [ ] Recovery is confirmed and audited.
- [ ] Provider status is honest.

### Security
- [ ] Tenant isolation on relevant routes.
- [ ] Role permissions implemented/tested.
- [ ] RLS configured where appropriate.
- [ ] Secrets absent from browser code/logs.
- [ ] Signatures verified for implemented providers.
- [ ] Input validation/body limits.
- [ ] Rate limits for sensitive/expensive endpoints.
- [ ] Repairs/retries idempotent or safely repeatable.
- [ ] Cross-tenant regression tests pass.

### Backend quality
- [ ] Critical uniqueness constraints enforced by DB.
- [ ] Indexes justified by query patterns.
- [ ] Critical query plans inspected.
- [ ] Queries and pagination bounded.
- [ ] Transactions short.
- [ ] Worker concurrency/recovery safe.
- [ ] Cache behavior documented/tested if used.
- [ ] Connection management respects deployment limits.
- [ ] Diagnostics useful and sanitized.

### Quality/presentation
- [ ] Type checking and linting pass.
- [ ] Relevant unit/integration tests pass.
- [ ] E2E tests cover primary workflow.
- [ ] No critical visible placeholders.
- [ ] UI polished/responsive.
- [ ] Docs accurate.
- [ ] Simulated behavior labeled.
- [ ] No paid service required for local demo.
- [ ] Limitations documented.

---

## 26. Execution rules

1. **Implement, don't merely plan.** Start real work after initial assessment.
2. **Prioritize the vertical slice:** payment → event → inconsistency → reconciliation → safe recovery → audit.
3. Use official documentation and verify current service limits.
4. Keep every major feature aligned with payment operations/reliability/reconciliation/recovery.
5. Prefer DB constraints, transactions, and tested invariants over assumptions.
6. Treat security as part of implementation, not a later phase only.
7. Treat performance as part of implementation: sensible indexes, bounded queries, limits, job controls; measure before caching.
8. Be honest about sandbox, unverified, unsupported, and simulated behavior.
9. Avoid microservices, Kubernetes, paid infrastructure, or elaborate abstractions without a concrete need.
10. Keep dependencies justified.
11. Keep the repository runnable between phases.
12. Run tests after meaningful changes and fix regressions.
13. Update `IMPLEMENTATION_STATUS.md` with what works, what was tested, what remains, and the next task.
14. When blocked by an API/free-tier limitation, explain it and provide a viable alternative.
15. Never claim unverified results.
16. Scaffolding, mock dashboards, and empty endpoints are not a completed product.
17. Finish with evidence: implemented functionality, architecture, tests actually run, launch/demo instructions, and remaining limitations.

### First response and actions

Inspect the repository and runtime/tooling. Give a brief assessment of current state, genuinely blocking issues, and immediate implementation steps. Create/update `IMPLEMENTATION_STATUS.md` and proceed with Phase 1.

Do not respond with another enormous plan, ask approval for routine technical decisions, or wait for further instructions before starting.

**The objective is a working, secure, polished, zero-required-spend portfolio product that demonstrates real engineering judgment—not just an impressive specification.**
