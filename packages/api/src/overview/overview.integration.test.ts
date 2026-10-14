import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Overview } from '@payscope/shared/overview-schemas';
import { createHarness, type TestUser } from '../test/identity-harness';
import {
  addCustomer,
  addEntitlement,
  addStuckEvent,
  addSubscription,
  seedConnection,
  type Org,
} from '../test/reconciliation-fixtures';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

type Tenant = Org & { owner: TestUser; customerId: string };

async function createTenant(): Promise<Tenant> {
  const owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Overview', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const org = await seedConnection(sql, res.json<{ id: string }>().id);
  return { ...org, owner, customerId: await addCustomer(sql, org) };
}

async function addPayment(
  t: Tenant,
  status: string,
  currency: string,
  amount: string,
  refunded = '0',
  createdAt = new Date().toISOString(),
) {
  await sql`insert into payment_records
    (org_id, connection_id, customer_id, provider_payment_id, status, amount_minor, amount_refunded_minor, currency, created_at)
    values (${t.orgId}, ${t.connectionId}, ${t.customerId}, ${`pi_${randomUUID()}`}, ${status},
      ${amount}, ${refunded}, ${currency}, ${createdAt})`;
}

async function addIncident(t: Tenant, status: string) {
  await sql`insert into incidents (org_id, category, severity, status, title, fingerprint)
    values (${t.orgId}, 'status_mismatch', 'high', ${status}, 'Incident', ${randomUUID()})`;
}

function overview(t: Tenant, query = '', user = t.owner) {
  return app.inject({
    url: `/api/v1/orgs/${t.orgId}/overview${query}`,
    headers: user.headers,
  });
}

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

describe('overview', () => {
  it('sums bigint amounts exactly and never mixes currencies', async () => {
    const t = await createTenant();
    const big = '9007199254740993';
    await addPayment(t, 'succeeded', 'USD', big);
    await addPayment(t, 'succeeded', 'USD', '10');
    await addPayment(t, 'partially_refunded', 'USD', '500', '200');
    await addPayment(t, 'succeeded', 'JPY', '700', '100');
    await addPayment(t, 'failed', 'JPY', '50');

    const res = await overview(t);
    const body = res.json<Overview>();
    expect(res.statusCode).toBe(200);
    expect(body.payments.map((c) => c.currency)).toEqual(['JPY', 'USD']);
    const usd = body.payments.find((c) => c.currency === 'USD');
    const jpy = body.payments.find((c) => c.currency === 'JPY');
    expect(usd).toMatchObject({
      total: 3,
      succeededAmountMinor: '9007199254741003',
      refundedAmountMinor: '200',
    });
    expect(usd?.byStatus).toMatchObject({ succeeded: 2, partially_refunded: 1, failed: 0 });
    expect(jpy).toMatchObject({
      total: 2,
      succeededAmountMinor: '700',
      refundedAmountMinor: '100',
    });
  });

  it('filters payments and events by range', async () => {
    const t = await createTenant();
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await addPayment(t, 'succeeded', 'USD', '100');
    await addPayment(t, 'succeeded', 'USD', '1000', '0', old);

    const week = (await overview(t, '?range=7d')).json<Overview>();
    const month = (await overview(t, '?range=30d')).json<Overview>();
    expect(week.payments[0]?.succeededAmountMinor).toBe('100');
    expect(month.payments[0]?.succeededAmountMinor).toBe('1100');
  });

  it('returns a null success rate and zeroed counts for an empty org', async () => {
    const t = await createTenant();
    const body = (await overview(t)).json<Overview>();
    expect(body.payments).toEqual([]);
    expect(body.processing).toEqual({ processed: 0, attempted: 0, successRate: null });
    expect(body.jobs).toEqual({ queued: 0, running: 0, dead: 0, oldestQueuedAgeSeconds: null });
    expect(body.findings.open).toBe(0);
    expect(body.incidents).toEqual({ open: 0, investigating: 0 });
    expect(body.recentEvents).toEqual([]);
    expect(body.subscriptions.active).toBe(0);
  });

  it('aggregates subscriptions, entitlements, events, jobs and findings', async () => {
    const t = await createTenant();
    const subId = await addSubscription(sql, t, t.customerId, 'active');
    await addSubscription(sql, t, t.customerId, 'past_due');
    await addEntitlement(sql, t, t.customerId, 'inconsistent', subId);
    await addStuckEvent(sql, t, 'obj_1', 'payment.succeeded', 'processed');
    await addStuckEvent(sql, t, 'obj_2', 'payment.succeeded', 'processed');
    await addStuckEvent(sql, t, 'obj_3', 'payment.failed', 'failed');
    await addStuckEvent(sql, t, 'obj_4', 'payment.failed', 'needs_attention');
    await sql`insert into background_jobs (org_id, kind, status, available_at)
      values (${t.orgId}, 'x', 'queued', now() - interval '2 minutes'),
             (${t.orgId}, 'x', 'dead', now())`;
    const runId = randomUUID();
    await sql`insert into reconciliation_runs (id, org_id, mode) values (${runId}, ${t.orgId}, 'local')`;
    await sql`insert into reconciliation_findings
      (org_id, type, severity, subject_type, subject_id, fingerprint, recommended_action, first_seen_run_id, last_seen_run_id)
      values (${t.orgId}, 'status_mismatch', 'high', 'payment', ${randomUUID()}, ${randomUUID()}, 'fix', ${runId}, ${runId})`;

    const body = (await overview(t)).json<Overview>();
    expect(body.subscriptions).toMatchObject({ active: 1, past_due: 1 });
    expect(body.entitlements.inconsistent).toBe(1);
    expect(body.processing).toEqual({ processed: 2, attempted: 4, successRate: 0.5 });
    expect(body.jobs).toMatchObject({ queued: 1, dead: 1 });
    expect(body.jobs.oldestQueuedAgeSeconds).toBeGreaterThanOrEqual(119);
    expect(body.findings).toMatchObject({ open: 1, bySeverity: { high: 1, low: 0 } });
    expect(body.recentEvents).toHaveLength(4);
  });

  it('isolates organizations and rejects non-members', async () => {
    const a = await createTenant();
    const b = await createTenant();
    await addPayment(a, 'succeeded', 'USD', '100');
    expect((await overview(b)).json<Overview>().payments).toEqual([]);
    expect((await overview(a, '', b.owner)).statusCode).toBe(404);
  });

  it('counts non-resolved incidents per status within the org only', async () => {
    const a = await createTenant();
    const b = await createTenant();
    await addIncident(a, 'open');
    await addIncident(a, 'open');
    await addIncident(a, 'investigating');
    await addIncident(a, 'resolved');
    await addIncident(b, 'open');
    expect((await overview(a)).json<Overview>().incidents).toEqual({ open: 2, investigating: 1 });
    expect((await overview(b)).json<Overview>().incidents).toEqual({ open: 1, investigating: 0 });
  });

  it('rejects an unknown range and marks responses as non-cacheable', async () => {
    const t = await createTenant();
    expect((await overview(t, '?range=1y')).statusCode).toBe(400);
    expect((await overview(t)).headers['cache-control']).toBe('private, no-store');
  });

  it('serves repeat requests inside the ttl from cache', async () => {
    const t = await createTenant();
    await addPayment(t, 'succeeded', 'USD', '100');
    const first = (await overview(t, '?range=90d')).json<Overview>();
    await addPayment(t, 'succeeded', 'USD', '100');
    const second = (await overview(t, '?range=90d')).json<Overview>();
    expect(first.payments[0]?.total).toBe(1);
    expect(second.payments[0]?.total).toBe(1);
  });
});
