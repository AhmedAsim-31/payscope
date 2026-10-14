import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REASON, repairCall, type Tenant } from '../test/ops-harness';
import { addCustomer, addEntitlement, addSubscription } from '../test/reconciliation-fixtures';
import {
  app,
  audits,
  behaviors,
  errorCode,
  fetchSubscription,
  refreshSub,
  registered,
  sql,
  subscriptionRow,
  tenant,
  useFake,
  useRefreshHarness,
} from './refresh-from-provider.harness';

useRefreshHarness();

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

describe('refresh recomputes subscription entitlements', () => {
  async function subscription(
    t: Tenant,
    status: string,
    opts: { periodEnd?: string; mapped?: boolean } = {},
  ) {
    const customerId = await addCustomer(sql, t);
    const id = await addSubscription(sql, t, customerId, status, opts.periodEnd ?? null);
    if (opts.mapped !== false) {
      await sql`update provider_connections set entitlement_map = '{"gold":["pro"]}'::jsonb
        where id = ${t.connectionId}`;
      await sql`update subscription_records set plan_ref = 'gold' where id = ${id}`;
    }
    return { id, customerId, providerId: (await subscriptionRow(id))?.providerId ?? '' };
  }

  const entitlementRow = async (customerId: string) => {
    const [row] = await sql<{ state: string; subscriptionId: string | null }[]>`
      select state, subscription_id as "subscriptionId" from entitlement_records
      where customer_id = ${customerId} and entitlement_key = 'pro'`;
    return row;
  };

  it('expires the linked entitlement when the provider reports the subscription expired', async () => {
    useFake();
    const t = await tenant();
    const sub = await subscription(t, 'active');
    await addEntitlement(sql, t, sub.customerId, 'active', sub.id);
    behaviors.set(sub.providerId, { kind: 'ok', status: 'expired' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      resultingState: { status: 'expired', entitlements: { state: 'expired', keys: ['pro'] } },
    });
    expect(await entitlementRow(sub.customerId)).toEqual({
      state: 'expired',
      subscriptionId: sub.id,
    });
    expect((await audits(t))[0]).toMatchObject({
      outcome: 'success',
      resulting: { entitlements: { state: 'expired', keys: ['pro'] } },
    });
  });

  it('grants the entitlement when a past-due subscription is active at the provider', async () => {
    useFake();
    const t = await tenant();
    const sub = await subscription(t, 'past_due');
    behaviors.set(sub.providerId, { kind: 'ok', status: 'active' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(200);
    expect(await entitlementRow(sub.customerId)).toEqual({
      state: 'active',
      subscriptionId: sub.id,
    });
  });

  it('keeps access through the paid period when the provider reports a cancellation', async () => {
    useFake();
    const t = await tenant();
    const periodEnd = new Date(Date.now() + 86_400_000).toISOString();
    const sub = await subscription(t, 'active', { periodEnd });
    await addEntitlement(sql, t, sub.customerId, 'active', sub.id);
    behaviors.set(sub.providerId, { kind: 'ok', status: 'canceled' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(200);
    expect((await entitlementRow(sub.customerId))?.state).toBe('active');
  });

  it('records no entitlement change when the plan is unmapped', async () => {
    useFake();
    const t = await tenant();
    const sub = await subscription(t, 'active', { mapped: false });
    behaviors.set(sub.providerId, { kind: 'ok', status: 'expired' });

    const res = await refreshSub(t, sub.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ resultingState: object }>().resultingState).not.toHaveProperty(
      'entitlements',
    );
  });
});
