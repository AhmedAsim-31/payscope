import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness, type TestUser } from '../test/identity-harness';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

type Page = { items: { id: string }[]; nextCursor: string | null };
type Tenant = { orgId: string; owner: TestUser; connectionId: string; customerId: string };

let a: Tenant;
let b: Tenant;

async function createTenant(): Promise<Tenant> {
  const owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Records', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const orgId = res.json<{ id: string }>().id;
  const connectionId = randomUUID();
  const customerId = randomUUID();
  await sql`insert into provider_connections (id, org_id, provider, mode, status, display_name, external_account_id)
    values (${connectionId}, ${orgId}, 'stripe', 'sandbox', 'active', 'Stripe', ${`acct_${randomUUID()}`})`;
  await sql`insert into customers (id, org_id, email, display_name)
    values (${customerId}, ${orgId}, 'Alice@Example.test', 'Alice')`;
  await sql`insert into provider_customer_mappings (org_id, connection_id, customer_id, provider_customer_id)
    values (${orgId}, ${connectionId}, ${customerId}, 'cus_1')`;
  return { orgId, owner, connectionId, customerId };
}

async function insertPayment(
  t: Tenant,
  over: { status?: string; currency?: string; amount?: string; createdAt?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await sql`insert into payment_records
    (id, org_id, connection_id, customer_id, provider_payment_id, status, amount_minor, currency, created_at)
    values (${id}, ${t.orgId}, ${t.connectionId}, ${t.customerId}, ${`pi_${id}`},
      ${over.status ?? 'succeeded'}, ${over.amount ?? '1000'}, ${over.currency ?? 'USD'},
      ${over.createdAt ?? '2026-01-01T00:00:00.000000Z'})`;
  return id;
}

function get<T>(user: TestUser, orgId: string, path: string) {
  return app
    .inject({ url: `/api/v1/orgs/${orgId}${path}`, headers: user.headers })
    .then((res) => ({ status: res.statusCode, body: res.json<T>() }));
}

beforeAll(async () => {
  app = await harness.start();
  a = await createTenant();
  b = await createTenant();
});
afterAll(() => harness.stop());

describe('payments', () => {
  it('pages stably across ties in created_at with no gaps or duplicates', async () => {
    const tied = '2026-02-01T00:00:00.123456Z';
    const ids = [] as string[];
    for (let i = 0; i < 7; i++) ids.push(await insertPayment(a, { createdAt: tied }));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `?currency=USD&from=2026-02-01T00:00:00Z&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await get<Page>(a.owner, a.orgId, `/payments${q}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((i) => i.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(7);
  });

  it('filters by status, provider, currency, connection and date range', async () => {
    const failed = await insertPayment(a, {
      status: 'failed',
      currency: 'EUR',
      createdAt: '2026-03-05T00:00:00Z',
    });
    const q = `?status=failed&provider=stripe&currency=EUR&connectionId=${a.connectionId}&from=2026-03-01T00:00:00Z&to=2026-03-10T00:00:00Z`;
    const hit = await get<Page>(a.owner, a.orgId, `/payments${q}`);
    expect(hit.body.items.map((i) => i.id)).toEqual([failed]);
    const miss = await get<Page>(a.owner, a.orgId, '/payments?provider=paddle');
    expect(miss.body.items).toEqual([]);
    const outOfRange = await get<Page>(
      a.owner,
      a.orgId,
      '/payments?status=failed&to=2026-03-01T00:00:00Z',
    );
    expect(outOfRange.body.items).toEqual([]);
  });

  it('filters by an inclusive amount range in minor units', async () => {
    const at = '2026-04-01T00:00:00Z';
    const small = await insertPayment(a, { amount: '499', createdAt: at });
    const low = await insertPayment(a, { amount: '500', createdAt: at });
    const high = await insertPayment(a, { amount: '1500', createdAt: at });
    await insertPayment(a, { amount: '1501', createdAt: at });
    const range = `from=${at}&to=2026-04-02T00:00:00Z`;
    const both = await get<Page>(
      a.owner,
      a.orgId,
      `/payments?${range}&minAmount=500&maxAmount=1500`,
    );
    expect(both.body.items.map((i) => i.id).sort()).toEqual([low, high].sort());
    const maxOnly = await get<Page>(a.owner, a.orgId, `/payments?${range}&maxAmount=499`);
    expect(maxOnly.body.items.map((i) => i.id)).toEqual([small]);
    const minOnly = await get<Page>(a.owner, a.orgId, `/payments?${range}&minAmount=1501`);
    expect(minOnly.body.items).toHaveLength(1);
  });

  it('rejects malformed amounts with 400 and an inverted range with 422', async () => {
    for (const bad of ['1.5', '-1', 'abc']) {
      const res = await get<{ error: { code: string } }>(
        a.owner,
        a.orgId,
        `/payments?minAmount=${bad}`,
      );
      expect(res.status).toBe(400);
    }
    const inverted = await get<{ error: { code: string } }>(
      a.owner,
      a.orgId,
      '/payments?minAmount=200&maxAmount=100',
    );
    expect(inverted.status).toBe(422);
    expect(inverted.body.error.code).toBe('INVALID_AMOUNT_RANGE');
  });

  it('serializes bigint amounts beyond 2^53 exactly', async () => {
    const big = '9007199254740993123';
    const id = await insertPayment(a, { amount: big });
    const res = await get<{
      amount: { amountMinor: string; currency: string };
      events: unknown[];
    }>(a.owner, a.orgId, `/payments/${id}`);
    expect(res.body.amount).toEqual({ amountMinor: big, currency: 'USD' });
    const list = await get<{ items: { id: string; amount: { amountMinor: string } }[] }>(
      a.owner,
      a.orgId,
      '/payments?limit=100',
    );
    expect(list.body.items.find((i) => i.id === id)?.amount.amountMinor).toBe(big);
  });

  it('returns related provider events for the payment object', async () => {
    const id = await insertPayment(a);
    const [payment] = await sql<{ provider_payment_id: string }[]>`
      select provider_payment_id from payment_records where id = ${id}`;
    await sql`insert into provider_events
      (org_id, connection_id, provider, provider_event_id, event_type, occurred_at, signature_verified, payload, object_ref)
      values (${a.orgId}, ${a.connectionId}, 'stripe', ${`evt_${randomUUID()}`}, 'payment_intent.succeeded',
        now(), true, '{}'::jsonb, ${payment?.provider_payment_id ?? ''})`;
    const res = await get<{ events: { eventType: string }[] }>(a.owner, a.orgId, `/payments/${id}`);
    expect(res.body.events.map((e) => e.eventType)).toEqual(['payment_intent.succeeded']);
  });

  it('caps limit at 100', async () => {
    const res = await get<Page>(a.owner, a.orgId, '/payments?limit=5000');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(100);
  });

  it('rejects an invalid cursor with 400', async () => {
    for (const cursor of ['not-a-cursor', Buffer.from('{"t":"x","i":"y"}').toString('base64url')]) {
      const res = await get<{ error: { code: string } }>(
        a.owner,
        a.orgId,
        `/payments?cursor=${cursor}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    }
  });

  it('isolates organizations and lets a VIEWER read', async () => {
    const aPayment = await insertPayment(a);
    const aCrossId = await get<unknown>(b.owner, b.orgId, `/payments/${aPayment}`);
    expect(aCrossId.status).toBe(404);
    const bList = await get<Page>(b.owner, b.orgId, '/payments?limit=100');
    expect(bList.body.items.map((i) => i.id)).not.toContain(aPayment);
    const notMember = await get<unknown>(b.owner, a.orgId, '/payments');
    expect(notMember.status).toBe(404);

    const viewer = await harness.newUser();
    await app.inject({ url: '/api/v1/orgs', headers: viewer.headers });
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${a.orgId}/members`,
      headers: a.owner.headers,
      payload: { email: viewer.email, role: 'VIEWER' },
    });
    const res = await get<Page>(viewer, a.orgId, '/payments');
    expect(res.status).toBe(200);
  });
});

describe('subscriptions, customers and entitlements', () => {
  let subscriptionId: string;
  let entitlementId: string;

  beforeAll(async () => {
    subscriptionId = randomUUID();
    entitlementId = randomUUID();
    await sql`insert into subscription_records
      (id, org_id, connection_id, customer_id, provider_subscription_id, status, plan_ref)
      values (${subscriptionId}, ${a.orgId}, ${a.connectionId}, ${a.customerId}, 'sub_1', 'past_due', 'pro')`;
    await sql`insert into entitlement_records
      (id, org_id, customer_id, subscription_id, entitlement_key, state, source)
      values (${entitlementId}, ${a.orgId}, ${a.customerId}, ${subscriptionId}, 'pro_access', 'inconsistent', 'reconciliation')`;
  });

  it('lists and filters subscriptions, with entitlements on the detail', async () => {
    const hit = await get<Page>(a.owner, a.orgId, '/subscriptions?status=past_due&provider=stripe');
    expect(hit.body.items.map((i) => i.id)).toEqual([subscriptionId]);
    const byCustomer = await get<Page>(
      a.owner,
      a.orgId,
      `/subscriptions?customerId=${a.customerId}&status=active`,
    );
    expect(byCustomer.body.items).toEqual([]);
    const detail = await get<{ entitlements: { id: string }[] }>(
      a.owner,
      a.orgId,
      `/subscriptions/${subscriptionId}`,
    );
    expect(detail.body.entitlements.map((e) => e.id)).toEqual([entitlementId]);
  });

  it('searches customers by exact provider customer id within the org only', async () => {
    const byId = await get<Page>(a.owner, a.orgId, '/customers?q=cus_1');
    expect(byId.body.items.map((i) => i.id)).toEqual([a.customerId]);
    const otherOrg = await get<Page>(b.owner, b.orgId, '/customers?q=cus_1');
    expect(otherOrg.body.items.map((i) => i.id)).toEqual([b.customerId]);
    const partial = await get<Page>(a.owner, a.orgId, '/customers?q=cus_');
    expect(partial.body.items).toEqual([]);
  });

  it('searches customers by case-insensitive email prefix and treats wildcards literally', async () => {
    const hit = await get<Page>(a.owner, a.orgId, '/customers?q=alice@EXA');
    expect(hit.body.items.map((i) => i.id)).toEqual([a.customerId]);
    const wildcard = await get<Page>(a.owner, a.orgId, '/customers?q=%25');
    expect(wildcard.body.items).toEqual([]);
    const detail = await get<{
      mappings: { providerCustomerId: string; provider: string }[];
      subscriptions: { id: string }[];
      entitlements: { id: string }[];
    }>(a.owner, a.orgId, `/customers/${a.customerId}`);
    expect(detail.body.mappings).toEqual([
      { provider: 'stripe', connectionId: a.connectionId, providerCustomerId: 'cus_1' },
    ]);
    expect(detail.body.subscriptions.map((s) => s.id)).toEqual([subscriptionId]);
    expect(detail.body.entitlements.map((e) => e.id)).toEqual([entitlementId]);
  });

  it('filters entitlements by state, customer and key', async () => {
    const q = `?state=inconsistent&customerId=${a.customerId}&key=pro_access`;
    const hit = await get<Page>(a.owner, a.orgId, `/entitlements${q}`);
    expect(hit.body.items.map((i) => i.id)).toEqual([entitlementId]);
    const miss = await get<Page>(a.owner, a.orgId, '/entitlements?state=active');
    expect(miss.body.items).toEqual([]);
    const one = await get<{ entitlementKey: string }>(
      a.owner,
      a.orgId,
      `/entitlements/${entitlementId}`,
    );
    expect(one.body.entitlementKey).toBe('pro_access');
  });

  it('hides other organizations rows on every domain', async () => {
    for (const path of [
      `/subscriptions/${subscriptionId}`,
      `/customers/${a.customerId}`,
      `/entitlements/${entitlementId}`,
    ]) {
      expect((await get<unknown>(b.owner, b.orgId, path)).status).toBe(404);
    }
    for (const list of ['subscriptions', 'customers', 'entitlements']) {
      const res = await get<Page>(b.owner, b.orgId, `/${list}`);
      const ids = res.body.items.map((i) => i.id);
      expect(ids).not.toContain(subscriptionId);
      expect(ids).not.toContain(a.customerId);
      expect(ids).not.toContain(entitlementId);
    }
  });
});

describe('related record filters', () => {
  let t: Tenant;
  let subscriptionId: string;
  let subPaymentId: string;
  let otherPaymentId: string;

  async function insertEvent(objectRef: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`insert into provider_events
      (org_id, connection_id, provider, provider_event_id, event_type, occurred_at, signature_verified, payload, object_ref)
      values (${t.orgId}, ${t.connectionId}, 'stripe', ${`evt_${randomUUID()}`}, 'x', now(), true, '{}'::jsonb, ${objectRef})
      returning id`;
    return row?.id ?? '';
  }

  async function insertFinding(subjectType: string, subjectId: string, runId: string) {
    const [row] = await sql<{ id: string }[]>`insert into reconciliation_findings
      (org_id, type, severity, subject_type, subject_id, fingerprint, recommended_action, first_seen_run_id, last_seen_run_id)
      values (${t.orgId}, 'status_mismatch', 'low', ${subjectType}, ${subjectId}, ${randomUUID()}, 'review', ${runId}, ${runId})
      returning id`;
    return row?.id ?? '';
  }

  beforeAll(async () => {
    t = await createTenant();
    subscriptionId = randomUUID();
    await sql`insert into subscription_records
      (id, org_id, connection_id, customer_id, provider_subscription_id, status)
      values (${subscriptionId}, ${t.orgId}, ${t.connectionId}, ${t.customerId}, 'sub_rel', 'active')`;
    subPaymentId = await insertPayment(t);
    await sql`update payment_records set provider_subscription_id = 'sub_rel' where id = ${subPaymentId}`;
    otherPaymentId = await insertPayment(t);
    await sql`update payment_records set customer_id = null where id = ${otherPaymentId}`;
  });

  it('filters payments by customer and by subscription', async () => {
    const byCustomer = await get<Page>(t.owner, t.orgId, `/payments?customerId=${t.customerId}`);
    expect(byCustomer.body.items.map((i) => i.id)).toEqual([subPaymentId]);
    const bySub = await get<Page>(t.owner, t.orgId, `/payments?subscriptionId=${subscriptionId}`);
    expect(bySub.body.items.map((i) => i.id)).toEqual([subPaymentId]);
    const cross = await get<Page>(b.owner, b.orgId, `/payments?subscriptionId=${subscriptionId}`);
    expect(cross.body.items).toEqual([]);
  });

  it('resolves the payment subscription id on the detail', async () => {
    const linked = await get<{ subscriptionId: string | null }>(
      t.owner,
      t.orgId,
      `/payments/${subPaymentId}`,
    );
    expect(linked.body.subscriptionId).toBe(subscriptionId);
    const unlinked = await get<{ subscriptionId: string | null }>(
      t.owner,
      t.orgId,
      `/payments/${otherPaymentId}`,
    );
    expect(unlinked.body.subscriptionId).toBeNull();
  });

  it('filters events by object ref and by customer', async () => {
    const subEvent = await insertEvent('sub_rel');
    const payEvent = await insertEvent(`pi_${subPaymentId}`);
    const customerEvent = await insertEvent('cus_1');
    await insertEvent(`pi_${otherPaymentId}`);

    const byRef = await get<Page>(
      t.owner,
      t.orgId,
      `/events?connectionId=${t.connectionId}&objectRef=sub_rel`,
    );
    expect(byRef.body.items.map((i) => i.id)).toEqual([subEvent]);
    const byCustomer = await get<Page>(t.owner, t.orgId, `/events?customerId=${t.customerId}`);
    expect(byCustomer.body.items.map((i) => i.id).sort()).toEqual(
      [subEvent, payEvent, customerEvent].sort(),
    );
    const cross = await get<Page>(b.owner, b.orgId, `/events?customerId=${t.customerId}`);
    expect(cross.body.items).toEqual([]);
  });

  it('filters findings by subject', async () => {
    const [run] = await sql<{ id: string }[]>`insert into reconciliation_runs (org_id, mode, status)
      values (${t.orgId}, 'local', 'completed') returning id`;
    const runId = run?.id ?? '';
    const findingId = await insertFinding('subscription', subscriptionId, runId);
    await insertFinding('payment', subPaymentId, runId);
    const hit = await get<Page>(
      t.owner,
      t.orgId,
      `/reconciliation/findings?subjectType=subscription&subjectId=${subscriptionId}`,
    );
    expect(hit.body.items.map((i) => i.id)).toEqual([findingId]);
  });
});
