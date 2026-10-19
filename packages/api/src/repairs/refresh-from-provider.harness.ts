import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { createAdapterRegistry } from '@payscope/provider-adapters/registry';
import { createHarness } from '../test/identity-harness';
import { REASON, repairCall, type Tenant } from '../test/ops-harness';
import {
  createFakeAdapter,
  seedConnection,
  type FakeBehavior,
} from '../test/reconciliation-fixtures';

const harness = createHarness();
export const { sql } = harness;
export let app: FastifyInstance;
let current: ReturnType<typeof createFakeAdapter>;
export const behaviors = new Map<string, FakeBehavior>();
export const fetchSubscription: NonNullable<ProviderAdapter['fetchSubscription']> = (ctx, id) =>
  current.adapter.fetchSubscription?.(ctx, id) ?? Promise.reject(new Error('unset'));
export const registered: ProviderAdapter = {
  ...createFakeAdapter(new Map()).adapter,
  fetchPayment: (ctx, id) =>
    current.adapter.fetchPayment?.(ctx, id) ?? Promise.reject(new Error('unset')),
  fetchSubscription,
};
const registry = createAdapterRegistry([registered]);

/** Registers one app per test file; module state is isolated per file by Vitest. */
export function useRefreshHarness() {
  beforeAll(async () => {
    app = await harness.start({ adapters: registry });
  });
  afterAll(() => harness.stop());
}

export function useFake(onCall?: (id: string) => Promise<void> | void) {
  behaviors.clear();
  current = createFakeAdapter(behaviors, onCall);
  return current;
}

export async function tenant(withCredentials = true): Promise<Tenant> {
  const owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Refresh', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const org = await seedConnection(sql, res.json<{ id: string }>().id, withCredentials);
  return { ...org, owner };
}

export const refresh = (t: Tenant, paymentId: string, key?: string) =>
  repairCall(app, t, t.owner, 'refresh-from-provider', { paymentId, reason: REASON }, key);

export const refreshSub = (t: Tenant, subscriptionId: string, key?: string) =>
  repairCall(app, t, t.owner, 'refresh-from-provider', { subscriptionId, reason: REASON }, key);

export const errorCode = (res: Awaited<ReturnType<typeof refresh>>) =>
  res.json<{ error: { code: string } }>().error.code;

export const paymentRow = async (id: string) => {
  const [row] = await sql<{ status: string; amount: string; version: number }[]>`
    select status, amount_minor::text as amount, version from payment_records where id = ${id}`;
  return row;
};

export const subscriptionRow = async (id: string) => {
  const [row] = await sql<{ status: string; version: number; providerId: string }[]>`
    select status, version, provider_subscription_id as "providerId"
    from subscription_records where id = ${id}`;
  return row;
};

export async function addFinding(
  t: Tenant,
  subjectType: string,
  subjectId: string,
  status = 'open',
) {
  const [run] = await sql<{ id: string }[]>`insert into reconciliation_runs (org_id, mode, status)
    values (${t.orgId}, 'provider', 'completed') returning id`;
  if (!run) throw new Error('no run');
  const [row] = await sql<{ id: string }[]>`insert into reconciliation_findings
    (org_id, type, severity, status, subject_type, subject_id, fingerprint, recommended_action,
     first_seen_run_id, last_seen_run_id)
    values (${t.orgId}, 'status_mismatch', 'high', ${status}, ${subjectType}, ${subjectId},
      ${`status_mismatch:${subjectType}:${subjectId}`}, 'review', ${run.id}, ${run.id})
    returning id`;
  return row?.id ?? '';
}

export const findingRow = async (id: string) => {
  const [row] = await sql<{ status: string; note: string | null }[]>`
    select status, resolution_note as note from reconciliation_findings where id = ${id}`;
  return row;
};

export const findingAudits = (t: Tenant, findingId: string) => sql<
  { actor: string | null; previous: unknown; resulting: unknown }[]
>`select actor_id as actor, previous_state as previous, resulting_state as resulting from audit_logs
  where org_id = ${t.orgId} and action = 'finding.resolve' and target_id = ${findingId}`;

export const audits = (t: Tenant) => sql<
  { outcome: string; previous: unknown; resulting: unknown }[]
>`
  select outcome, previous_state as previous, resulting_state as resulting from audit_logs
  where org_id = ${t.orgId} and action = 'repair.refresh_from_provider' order by created_at`;
