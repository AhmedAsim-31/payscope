import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Role } from '@payscope/shared/permissions';
import { DEFAULT_POLICIES, POLICY_NAMES, type RatePolicies } from '../rate-limit/policies';
import type { createHarness, TestUser } from '../test/identity-harness';
import {
  addCustomer,
  addEntitlement,
  addPayment,
  addSubscription,
  seedConnection,
} from '../test/reconciliation-fixtures';

type Harness = ReturnType<typeof createHarness>;

export const UNLIMITED_RATE_LIMITS = Object.fromEntries(
  POLICY_NAMES.map((n) => [n, { ...DEFAULT_POLICIES[n], max: 1_000_000 }]),
) as RatePolicies;

export type Tenant = {
  orgId: string;
  users: Record<Role, TestUser>;
  ids: Record<
    | 'connectionId'
    | 'customerId'
    | 'paymentId'
    | 'subscriptionId'
    | 'entitlementId'
    | 'eventId'
    | 'runId'
    | 'findingId'
    | 'incidentId'
    | 'scenarioId',
    string
  >;
};

export async function seedTenant(harness: Harness, app: FastifyInstance): Promise<Tenant> {
  const { sql } = harness;
  const owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Isolation', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const orgId = res.json<{ id: string }>().id;
  const users = { OWNER: owner } as Record<Role, TestUser>;
  for (const role of ['ADMIN', 'OPERATOR', 'VIEWER'] as const) {
    const user = await harness.newUser();
    await app.inject({ url: '/api/v1/orgs', headers: user.headers });
    await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${user.id}, ${role})`;
    users[role] = user;
  }
  const org = await seedConnection(sql, orgId);
  const customerId = await addCustomer(sql, org);
  const payment = await addPayment(sql, org, { customerId });
  const subscriptionId = await addSubscription(sql, org, customerId, 'active');
  const entitlementId = await addEntitlement(sql, org, customerId, 'active', subscriptionId);
  const [event] = await sql<{ id: string }[]>`
    insert into provider_events
      (org_id, connection_id, provider, provider_event_id, event_type, normalized_type, occurred_at,
       status, signature_verified, payload, object_ref)
    values (${orgId}, ${org.connectionId}, 'stripe', ${`evt_${randomUUID()}`}, 'x', 'x', now(),
      'needs_attention', true, '{}'::jsonb, 'obj')
    returning id`;
  const [run] = await sql<{ id: string }[]>`
    insert into reconciliation_runs (org_id, mode, status) values (${orgId}, 'local', 'completed')
    returning id`;
  const [finding] = await sql<{ id: string }[]>`
    insert into reconciliation_findings
      (org_id, type, severity, subject_type, subject_id, fingerprint, recommended_action,
       first_seen_run_id, last_seen_run_id)
    values (${orgId}, 'status_mismatch', 'low', 'payment', ${payment.id}, ${randomUUID()}, 'review',
      ${run?.id ?? ''}, ${run?.id ?? ''})
    returning id`;
  const [incident] = await sql<{ id: string }[]>`
    insert into incidents (org_id, category, severity, title, fingerprint)
    values (${orgId}, 'processing', 'low', 'Isolation incident', ${randomUUID()})
    returning id`;
  await sql`insert into event_processing_attempts (org_id, event_id, attempt_number, outcome)
    values (${orgId}, ${event?.id ?? ''}, 1, 'failed')`;
  await sql`insert into idempotency_records (org_id, scope, key, request_hash, expires_at)
    values (${orgId}, 'iso', ${randomUUID()}, 'h', now() + interval '1 day')`;
  return {
    orgId,
    users,
    ids: {
      connectionId: org.connectionId,
      customerId,
      paymentId: payment.id,
      subscriptionId,
      entitlementId,
      eventId: event?.id ?? '',
      runId: run?.id ?? '',
      findingId: finding?.id ?? '',
      incidentId: incident?.id ?? '',
      scenarioId: 'successful-payment',
    },
  };
}

export type RegisteredRoute = { method: string; path: string };

/** Flattens Fastify's printRoutes radix tree into method + full path pairs. */
export function registeredRoutes(app: FastifyInstance): RegisteredRoute[] {
  const stack: string[] = [];
  const routes: RegisteredRoute[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^((?:│ {3}| {4})*)[├└]── (\S+) \(([^)]+)\)/.exec(line);
    if (!m) continue;
    const depth = (m[1] ?? '').length / 4;
    stack.length = depth;
    stack.push(m[2] ?? '');
    for (const method of (m[3] ?? '').split(', ')) {
      if (method !== 'HEAD' && method !== 'OPTIONS') {
        routes.push({ method, path: stack.join('') });
      }
    }
  }
  return routes;
}
