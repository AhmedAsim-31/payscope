# Demo script

A five-minute walkthrough of the guided case "payment succeeded, but access was not granted", followed by the scenario lab.
Everything shown is fictional seed data on simulation-mode connections; no provider is called.
See [demo.md](demo.md) for what the seed contains and [../IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md) for what is real and what is simulated.

## Before you start

1. Start from the local setup in the [README](../README.md), with `.env.local` filled in.
2. Run `pnpm demo:reset`.
   It applies migrations, then deletes and re-seeds only the two demo orgs.
   It refuses any `DATABASE_URL` host other than `localhost` or `127.0.0.1` unless `SEED_ALLOW_REMOTE=true`.
3. Run `pnpm dev` and open http://localhost:3000/login.
4. Sign in as `demo-owner@example.com` with the password from `DEMO_USER_PASSWORD` in `.env.local`.
   Keep the password off screen.

Reset again before every demo.
The walkthrough resolves a finding, so a second run without a reset has nothing left to repair.

## 0:00 Overview (30 seconds)

Page: Overview for Acme Streaming (demo), the landing page after sign-in.

- Point at the "Sandbox · fictional data" badge in the header: every screen carries it.
- Payments are grouped per currency (EUR, GBP, JPY, USD) and never summed across currencies; money is stored as integer minor units.
- Processing success rate shows 3 events that failed, and the Jobs card shows 3 dead jobs.
  Those are seeded on purpose.
- Open findings and Open incidents are 0 because no reconciliation has run yet.
  The Open incidents tile links to the incidents list filtered to open, so the number matches the list.

## 0:30 The payment (45 seconds)

1. Click Payments in the sidebar.
2. Click `pi_demo_maya_guided` (19.99 USD, Stripe, maya.patel@example.com).
3. Point out the two clocks: "Provider time (created at the provider)" and "Received time (first seen by PayScope)".
4. Scroll to "Related provider events": the Stripe event that created this payment, with its processing status.
5. Click an event to open it.
   In "Details", point at "Object" (the provider object the event refers to) and "Signature".
   Seed events are written through the verified-ingest path, so they show Verified.
6. Show "Related": links back to this payment, its subscription, and its customer, resolved only within the same org and connection.
7. Show "Processing attempts", the "Job" section, and the stored "Payload".
   The event was persisted before the webhook was acknowledged and processed by the worker afterwards.

## 1:15 The inconsistency (30 seconds)

1. Click the customer link in "Related" (maya.patel@example.com).
2. On the customer page, "Subscriptions" shows an active subscription on `price_demo_pro`.
3. "Entitlements" is empty.
   She paid and is subscribed, but has no `pro` access.
   This is the drift reconciliation is built to catch.

## 1:45 Reconciliation (45 seconds)

1. Click Reconciliation.
2. Set Mode to "Local rules" and click "Start run".
3. Wait for the new run to reach Completed (a few seconds; the page polls).
   Local rules compare stored payments, subscriptions, and entitlements; provider mode needs a sandbox API key and is not configured in the demo.
4. Click Findings.
   Expect `entitlement_missing_or_stale` findings (Maya and others) and `expired_externally_active_locally` findings (for example Noah Kim, whose subscription expired while `pro` stayed active).
5. Optional: click Incidents.
   The run opened one incident per high-severity finding type.
   Severity and Category filters narrow the list.
   Open an incident and click "View findings": the list is filtered to that incident's finding type and its latest run, not every finding of that type in the org.
   Back on Overview, the Open incidents tile now counts these incidents.

## 2:30 Inspect and repair (60 seconds)

1. On Findings, set Type to entitlement missing or stale, click Apply, and open the one whose Evidence names Maya's customer id.
2. Point out "Recommended action", the "Details" (first and last run that saw it), and "Evidence".
3. Click "Correct entitlement".
   The dialog shows the previous state ("No active entitlement") and the result ("Entitlement active (manual repair)") and requires a reason.
4. Type a reason, for example "Active pro subscription with a succeeded payment", and confirm.
5. The finding now shows Resolved and the button is gone.
   The repair is idempotent: repeating it does not create a second entitlement.
6. Optional: open the entitlement incident.
   Its finding count dropped by one in the same transaction as the repair.
   It stays open while other high or critical findings of that type remain, and auto-resolves, with a system timeline entry and audit row, once the last one is resolved or dismissed.

## 3:30 Confirm and audit (30 seconds)

1. Open Maya's customer page again: "Entitlements" now lists an active `pro` entitlement.
2. Click Audit, enter `repair.correct_entitlement` in Action, and click Apply.
   The row shows the actor's email, when, and the reason.
   The target links to the finding's detail page.
   System actions show "System".
   The audit log is append-only.

## 4:00 Scenario lab (60 seconds)

1. Click Scenario lab.
   Each card is labeled "Local simulation" and runs on a dedicated "Scenario lab (demo)" connection, so seed data is never touched.
2. On "5. Duplicate webhook", click "Run scenario".
   The result shows "The expected outcome was observed.", the checks that passed, and the HTTP evidence: the second delivery is acknowledged as a duplicate and only one event and one payment exist.
3. If time allows, run "11. Invalid signature" (HTTP 400, nothing stored) or "17. Worker crash and expired lease recovery".
4. Click "Reset scenario lab" and confirm to clear lab runs and lab data.

## Optional extras

- Retry a failed event: Events, filter Status to "Needs attention", open one, click "Retry processing".
  Attempts made by the worker show a correlation ID, and a retryable failure also shows "Next retry".
  Seeded attempts were not run by the worker, so they carry no correlation ID.
  Sign in as `demo-viewer@example.com` to show that a viewer gets no retry button.
- Jobs: the cards are Queued, Running, Retrying, Dead, and Oldest queued.
  Retrying counts queued jobs that already failed at least once; Dead counts jobs out of attempts.
- Export: on Payments or Findings, click "Export CSV".
  The file uses the current filters, stores amounts as integer minor units with the currency, and stops at 5,000 rows.
  Owners, admins, and operators can export; a viewer does not see the button.
- Customer search: on Customers, type an email prefix (for example `maya`) or an exact provider customer id.
  A partial provider id does not match.
- Subscription detail shows "Canceled" and "Ended" when the provider reported them.
  Stripe sends both, Paddle sends only the cancellation time, RevenueCat sends only the end time on expiration, and PayPal sends neither.
- Tenant isolation: switch the org selector to Globex Apps (demo); none of the Acme rows appear.
- Filters: on Payments, type a currency and a minimum amount, then click Apply once; both filters apply together.
- Readiness: `GET /ready` on the API includes a `worker` check when `RUN_WORKER_IN_PROCESS=true`, and returns 503 if the worker heartbeat is older than 60 seconds with defaults.
- Dark mode and mobile: the app follows the OS color scheme and works at 375 pixels wide.

## What to say is simulated

- All connections are simulation mode; no live or sandbox provider credentials are configured.
- Seed events are built from adapter fixtures and run through the real ingest and processing code.
  They skip the HTTP signature check, which is why they show Verified.
- "Refresh from provider" needs provider credentials, which the demo connections do not have, so it answers `PROVIDER_NOT_CONFIGURED`.
  Its provider path, including the entitlement recompute and resolving findings on `ALREADY_CONSISTENT`, is covered only by integration tests with a fake adapter.
- The provider API failure and mismatch scenarios use a fake provider fetch that exists only inside the lab.
- Nothing is hosted; this runs on a local Postgres and the owner's Supabase Auth project.
