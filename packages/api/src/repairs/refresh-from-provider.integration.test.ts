import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { createAdapterRegistry } from '@payscope/provider-adapters/registry';
import { createHarness, type TestUser } from '../test/identity-harness';
import { REASON, repairCall, type Tenant } from '../test/ops-harness';
import {
  addCustomer,
  addPayment,
  addSubscription,
  createFakeAdapter,
  seedConnection,
  type FakeBehavior,
} from '../test/reconciliation-fixtures';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;
let owner: TestUser;
let current: ReturnType<typeof createFakeAdapter>;
const behaviors = new Map<string, FakeBehavior>();
const fetchSubscription: NonNullable<ProviderAdapter['fetchSubscription']> = (ctx, id) =>
  current.adapter.fetchSubscription?.(ctx, id) ?? Promise.reject(new Error('unset'));
const registered: ProviderAdapter = {
  ...createFakeAdapter(new Map()).adapter,
  fetchPayment: (ctx, id) =>
    current.adapter.fetchPayment?.(ctx, id) ?? Promise.reject(new Error('unset')),
  fetchSubscription,
};
const registry = createAdapterRegistry([registered]);

beforeAll(async () => {
  app = await harness.start({ adapters: registry });
  owner = await harness.newUser();
});
afterAll(() => harness.stop());

function useFake(onCall?: (id: string) => Promise<void> | void) {
  behaviors.clear();
  current = createFakeAdapter(behaviors, onCall);
  return current;
}

async function tenant(withCredentials = true): Promise<Tenant> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Refresh', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const org = await seedConnection(sql, res.json<{ id: string }>().id, withCredentials);
  return { ...org, owner };
}

const refresh = (t: Tenant, paymentId: string, key?: string) =>
  repairCall(app, t, t.owner, 'refresh-from-provider', { paymentId, reason: REASON }, key);

const refreshSub = (t: Tenant, subscriptionId: string, key?: string) =>
  repairCall(app, t, t.owner, 'refresh-from-provider', { subscriptionId, reason: REASON }, key);

const errorCode = (res: Awaited<ReturnType<typeof refresh>>) =>
  res.json<{ error: { code: string } }>().error.code;

const paymentRow = async (id: string) => {
  const [row] = await sql<{ status: string; amount: string; version: number }[]>`
    select status, amount_minor::text as amount, version from payment_records where id = ${id}`;
  return row;
};

const subscriptionRow = async (id: string) => {
  const [row] = await sql<{ status: string; version: number; providerId: string }[]>`
    select status, version, provider_subscription_id as "providerId"
    from subscription_records where id = ${id}`;
  return row;
};

async function addFinding(t: Tenant, subjectType: string, subjectId: string, status = 'open') {
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

const findingRow = async (id: string) => {
  const [row] = await sql<{ status: string; note: string | null }[]>`
    select status, resolution_note as note from reconciliation_findings where id = ${id}`;
  return row;
};

const findingAudits = (t: Tenant, findingId: string) => sql<
  { actor: string | null; previous: unknown; resulting: unknown }[]
>`select actor_id as actor, previous_state as previous, resulting_state as resulting from audit_logs
  where org_id = ${t.orgId} and action = 'finding.resolve' and target_id = ${findingId}`;

const audits = (t: Tenant) => sql<{ outcome: string; previous: unknown; resulting: unknown }[]>`
  select outcome, previous_state as previous, resulting_state as resulting from audit_logs
  where org_id = ${t.orgId} and action = 'repair.refresh_from_provider' order by created_at`;

describe('refresh payment from provider', () => {
  it('updates the payment to the provider state, audits before/after, and replays safely', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending', amount: 1000 });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded', amountMinor: 1500n });
    const key = randomUUID();

    const res = await refresh(t, pay.id, key);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      action: 'refresh_from_provider',
      targetId: pay.id,
      previousState: { status: 'pending', amountMinor: '1000', currency: 'USD' },
      resultingState: { status: 'succeeded', amountMinor: '1500', currency: 'USD' },
    });
    expect(await paymentRow(pay.id)).toEqual({ status: 'succeeded', amount: '1500', version: 1 });

    const replay = await refresh(t, pay.id, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(res.json());
    const rows = await audits(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'success',
      previous: { status: 'pending', amountMinor: '1000' },
      resulting: { status: 'succeeded', amountMinor: '1500', providerStatus: 'succeeded' },
    });
  });

  it('rejects an unverified connection without calling the provider', async () => {
    const fake = useFake();
    const t = await tenant();
    await sql`update provider_connections set status = 'unverified' where id = ${t.connectionId}`;
    const pay = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded' });

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('CONNECTION_NOT_VERIFIED');
    expect(fake.calls).toHaveLength(0);
    expect((await paymentRow(pay.id))?.status).toBe('pending');
    expect((await audits(t))[0]?.outcome).toBe('failure');
  });

  it('rejects a connection without credentials', async () => {
    const fake = useFake();
    const t = await tenant(false);
    const pay = await addPayment(sql, t, { status: 'pending' });

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('PROVIDER_NOT_CONFIGURED');
    expect(fake.calls).toHaveLength(0);
  });

  it('changes nothing when the provider does not have the payment', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('PROVIDER_OBJECT_NOT_FOUND');
    expect(await paymentRow(pay.id)).toMatchObject({ status: 'pending', version: 0 });
  });

  it('reports a provider outage as unavailable', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'error', category: 'unavailable' });

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(502);
    expect(errorCode(res)).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not downgrade a locally refunded payment the provider reports as succeeded', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'refunded', amount: 1000, refunded: 1000 });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded', amountMinor: 1000n });

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('ALREADY_CONSISTENT');
    expect((await paymentRow(pay.id))?.status).toBe('refunded');
  });

  it('rejects a provider status it cannot map', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'requires_action_unknown' });

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(422);
    expect(errorCode(res)).toBe('PROVIDER_STATUS_UNMAPPED');
  });

  it('does not clobber a payment that changed while the provider was being read', async () => {
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    useFake(async () => {
      await sql`update payment_records set status = 'failed', version = version + 1 where id = ${pay.id}`;
    });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded' });

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('CONCURRENT_UPDATE');
    expect(await paymentRow(pay.id)).toMatchObject({ status: 'failed', version: 1 });
  });

  it('returns 404 for a payment in another organization', async () => {
    useFake();
    const a = await tenant();
    const b = await tenant();
    const pay = await addPayment(sql, b, { status: 'pending' });

    const res = await refresh(a, pay.id);
    expect(res.statusCode).toBe(404);
  });
});

describe('refresh subscription from provider', () => {
  async function subscription(t: Tenant, status: string) {
    const id = await addSubscription(sql, t, await addCustomer(sql, t), status);
    return { id, providerId: (await subscriptionRow(id))?.providerId ?? '' };
  }

  it('updates the subscription status to the provider state and audits it', async () => {
    useFake();
    const t = await tenant();
    const sub = await subscription(t, 'active');
    behaviors.set(sub.providerId, { kind: 'ok', status: 'canceled' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      action: 'refresh_from_provider',
      targetId: sub.id,
      previousState: { status: 'active' },
      resultingState: { status: 'canceled', providerStatus: 'canceled' },
    });
    expect(await subscriptionRow(sub.id)).toMatchObject({ status: 'canceled', version: 1 });
    expect((await audits(t))[0]).toMatchObject({ outcome: 'success' });
  });

  it('maps provider spellings onto local statuses', async () => {
    useFake();
    const t = await tenant();
    const sub = await subscription(t, 'active');
    behaviors.set(sub.providerId, { kind: 'ok', status: 'SUSPENDED' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(200);
    expect((await subscriptionRow(sub.id))?.status).toBe('paused');
  });

  it('reports a subscription that already matches the provider', async () => {
    useFake();
    const t = await tenant();
    const sub = await subscription(t, 'active');
    behaviors.set(sub.providerId, { kind: 'ok', status: 'active' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('ALREADY_CONSISTENT');
  });

  it('rejects a provider subscription status it cannot map', async () => {
    useFake();
    const t = await tenant();
    const sub = await subscription(t, 'active');
    behaviors.set(sub.providerId, { kind: 'ok', status: 'inactive' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(422);
    expect(errorCode(res)).toBe('PROVIDER_STATUS_UNMAPPED');
    expect(await subscriptionRow(sub.id)).toMatchObject({ status: 'active', version: 0 });
  });

  it('rejects a provider whose adapter cannot fetch subscriptions', async () => {
    const fake = useFake();
    const t = await tenant();
    const sub = await subscription(t, 'active');
    delete registered.fetchSubscription;
    try {
      const res = await refreshSub(t, sub.id);
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('PROVIDER_FETCH_UNSUPPORTED');
      expect(fake.calls).toHaveLength(0);
    } finally {
      registered.fetchSubscription = fetchSubscription;
    }
  });

  it('does not clobber a subscription that changed while the provider was being read', async () => {
    const t = await tenant();
    const sub = await subscription(t, 'active');
    useFake(async () => {
      await sql`update subscription_records set status = 'past_due', version = version + 1 where id = ${sub.id}`;
    });
    behaviors.set(sub.providerId, { kind: 'ok', status: 'canceled' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('CONCURRENT_UPDATE');
    expect(await subscriptionRow(sub.id)).toMatchObject({ status: 'past_due', version: 1 });
  });

  it('returns 404 for a subscription in another organization', async () => {
    useFake();
    const a = await tenant();
    const b = await tenant();
    const sub = await subscription(b, 'active');

    const res = await refreshSub(a, sub.id);
    expect(res.statusCode).toBe(404);
  });

  it('rejects a body naming both a payment and a subscription', async () => {
    useFake();
    const t = await tenant();
    const res = await repairCall(app, t, t.owner, 'refresh-from-provider', {
      paymentId: randomUUID(),
      subscriptionId: randomUUID(),
      reason: REASON,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('refresh resolves the originating finding', () => {
  it('resolves an open status mismatch on the refreshed subscription and audits it', async () => {
    useFake();
    const t = await tenant();
    const subId = await addSubscription(sql, t, await addCustomer(sql, t), 'active');
    const providerId = (await subscriptionRow(subId))?.providerId ?? '';
    behaviors.set(providerId, { kind: 'ok', status: 'past_due' });
    const findingId = await addFinding(t, 'subscription', subId);

    const res = await refreshSub(t, subId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ resultingState: { resolvedFindingIds: [findingId] } });
    expect(await findingRow(findingId)).toEqual({ status: 'resolved', note: REASON });
    const rows = await findingAudits(t, findingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      previous: { status: 'open' },
      resulting: { status: 'resolved', via: 'refresh_from_provider' },
    });
  });

  it('resolves an open status mismatch on the refreshed payment', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded' });
    const findingId = await addFinding(t, 'payment', pay.id, 'reviewed');

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(200);
    expect((await findingRow(findingId))?.status).toBe('resolved');
    expect((await findingAudits(t, findingId))[0]).toMatchObject({
      previous: { status: 'reviewed' },
    });
  });

  it('leaves the finding open when the mapped status still differs from the provider', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'completed' });
    const findingId = await addFinding(t, 'payment', pay.id);

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(200);
    expect((await findingRow(findingId))?.status).toBe('open');
    expect(await findingAudits(t, findingId)).toHaveLength(0);
  });

  it('does not touch dismissed findings or findings on other records', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    const other = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded' });
    const dismissed = await addFinding(t, 'payment', pay.id, 'dismissed');
    const unrelated = await addFinding(t, 'payment', other.id);

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(200);
    expect((await findingRow(dismissed))?.status).toBe('dismissed');
    expect((await findingRow(unrelated))?.status).toBe('open');
  });
});
