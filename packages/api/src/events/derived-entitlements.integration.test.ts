import { paddleAdapter } from '@payscope/provider-adapters/paddle/paddle-adapter';
import { paypalAdapter } from '@payscope/provider-adapters/paypal/paypal-adapter';
import { loadPayPalFixture } from '@payscope/provider-adapters/paypal/paypal-fixtures';
import { stripeAdapter } from '@payscope/provider-adapters/stripe/stripe-adapter';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { createProcessProviderEventHandler } from '../jobs/handlers/process-provider-event';
import {
  attemptRows,
  paddle,
  payments,
  registry,
  seedConnection,
  silent,
  storeEvent,
  stripe,
  type Obj,
  type Seed,
} from '../test/event-harness';
import { parkQueuedJobs } from '../test/job-fixtures';
import { TEST_DATABASE_URL } from '../test/test-database-url';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 10 });
const handler = createProcessProviderEventHandler(registry);
const ctx = { db, logger: silent, workerId: 'test' };

beforeAll(() => parkQueuedJobs(sql));
afterAll(() => sql.end({ timeout: 1 }));

async function seedMapped(provider: Parameters<typeof seedConnection>[1], plan: string) {
  const seed = await seedConnection(sql, provider);
  const map = JSON.stringify({ [plan]: ['pro', 'beta'] });
  await sql`update provider_connections set entitlement_map = ${map}::jsonb where id = ${seed.connectionId}`;
  return seed;
}

async function run(seed: Seed, adapter: ProviderAdapter, payload: Record<string, unknown>) {
  const stored = await storeEvent(sql, seed, adapter, payload);
  await handler(stored.job, ctx);
  return stored;
}

async function pro(seed: Seed) {
  const [row] = await sql<{ state: string; source: string; expires_at: Date | null }[]>`
    select state, source, expires_at from entitlement_records
    where org_id = ${seed.orgId} and entitlement_key = 'pro'`;
  return row;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const items =
  (end: number, price = 'price_test_pro_monthly') =>
  (o: Obj) => {
    o['status'] = 'active';
    o['items'] = { data: [{ current_period_end: end, price: { id: price } }] };
  };

describe('stripe derived entitlements', () => {
  it('revokes nothing when a one-off payment is fully refunded', async () => {
    const seed = await seedMapped('stripe', 'price_test_pro_monthly');
    await run(seed, stripeAdapter, stripe('customer-subscription-created', 1760000006));
    await run(seed, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    await run(
      seed,
      stripeAdapter,
      stripe('charge-refunded', 1760000020, (o) => (o['amount_refunded'] = 4999)),
    );
    expect((await payments(sql, seed))[0]?.status).toBe('refunded');
    const rows = await sql<{ state: string }[]>`
      select state from entitlement_records where org_id = ${seed.orgId}`;
    expect(rows.map((r) => r.state)).toEqual(['active', 'active']);
  });

  it('grants on create, extends on renewal, keeps on cancel_at_period_end, expires on delete', async () => {
    const seed = await seedMapped('stripe', 'price_test_pro_monthly');
    await run(seed, stripeAdapter, stripe('customer-subscription-created', 1760000006));
    expect(await pro(seed)).toMatchObject({ state: 'active', source: 'provider_event' });
    expect(iso((await pro(seed))?.expires_at)).toBe('2025-11-08T08:53:20.000Z');

    await run(
      seed,
      stripeAdapter,
      stripe('customer-subscription-updated', 1760000100, items(1765000000)),
    );
    expect(iso((await pro(seed))?.expires_at)).toBe('2025-12-06T05:46:40.000Z');

    await run(
      seed,
      stripeAdapter,
      stripe('customer-subscription-updated', 1760000200, (o) => {
        items(1765000000)(o);
        o['cancel_at_period_end'] = true;
      }),
    );
    expect((await pro(seed))?.state).toBe('active');

    await run(seed, stripeAdapter, stripe('customer-subscription-deleted', 1760000300));
    expect((await pro(seed))?.state).toBe('expired');
  });

  it('ignores an older event arriving after a newer one', async () => {
    const seed = await seedMapped('stripe', 'price_test_pro_monthly');
    await run(seed, stripeAdapter, stripe('customer-subscription-deleted', 1760000300));
    await run(seed, stripeAdapter, stripe('customer-subscription-created', 1760000006));
    expect((await pro(seed))?.state).toBe('expired');
  });

  it('creates no entitlement and notes an unmapped plan', async () => {
    const seed = await seedMapped('stripe', 'price_other');
    const stored = await run(
      seed,
      stripeAdapter,
      stripe('customer-subscription-created', 1760000006),
    );
    expect(await pro(seed)).toBeUndefined();
    const [attempt] = await attemptRows(sql, stored.eventId);
    expect(attempt).toMatchObject({ outcome: 'succeeded', error_message: 'plan_unmapped' });
  });
});

describe('paddle derived entitlements', () => {
  it('grants from the item price and expires on cancel after the period', async () => {
    const seed = await seedMapped('paddle', 'pri_pro');
    const withPrice = (d: Obj) => {
      d['items'] = [{ price: { id: 'pri_pro' } }];
    };
    await run(seed, paddleAdapter, paddle('subscription-created', undefined, withPrice));
    expect(await pro(seed)).toMatchObject({ state: 'active' });
    expect(iso((await pro(seed))?.expires_at)).toBe('2026-11-01T10:00:00.000Z');
    await run(
      seed,
      paddleAdapter,
      paddle('subscription-canceled', '2026-10-20T00:00:00.000000Z', withPrice),
    );
    expect((await pro(seed))?.state).toBe('active');
  });
});

describe('paddle refund revocation', () => {
  const SUB_A = 'sub_01k00000000000000000000001';
  const SUB_B = 'sub_01k0000000000000000000000b';
  const at = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, '0')}:00.000000Z`;
  const subscription = (id: string, price: string) => (d: Obj) => {
    d['id'] = id;
    d['items'] = [{ price: { id: price } }];
  };
  const refund = (total: string) => (d: Obj) => {
    (d['totals'] as Obj)['total'] = total;
  };

  async function seedTwoSubscriptions() {
    const seed = await seedConnection(sql, 'paddle');
    const map = JSON.stringify({ pri_pro: ['pro'], pri_team: ['team'] });
    await sql`update provider_connections set entitlement_map = ${map}::jsonb where id = ${seed.connectionId}`;
    // The payment lands before either subscription, so the link must resolve at refund time.
    await run(seed, paddleAdapter, paddle('transaction-completed-subscription-first', at(1)));
    await run(
      seed,
      paddleAdapter,
      paddle('subscription-created', at(2), subscription(SUB_A, 'pri_pro')),
    );
    await run(
      seed,
      paddleAdapter,
      paddle('subscription-created', at(3), subscription(SUB_B, 'pri_team')),
    );
    return seed;
  }

  async function states(seed: Seed) {
    const rows = await sql<{ entitlement_key: string; state: string }[]>`
      select entitlement_key, state from entitlement_records
      where org_id = ${seed.orgId} order by entitlement_key`;
    return Object.fromEntries(rows.map((r) => [r.entitlement_key, r.state]));
  }

  it('revokes only the refunded subscription and ignores a partial refund', async () => {
    const seed = await seedTwoSubscriptions();
    expect(await states(seed)).toEqual({ pro: 'active', team: 'active' });

    await run(
      seed,
      paddleAdapter,
      paddle('adjustment-created-refund-approved', at(4), refund('1000')),
    );
    expect(await states(seed)).toEqual({ pro: 'active', team: 'active' });

    await run(
      seed,
      paddleAdapter,
      paddle('adjustment-created-refund-approved', at(5), refund('1499')),
    );
    expect((await payments(sql, seed))[0]?.status).toBe('refunded');
    expect(await states(seed)).toEqual({ pro: 'revoked', team: 'active' });
  });

  it('leaves another org untouched when a full refund revokes entitlements', async () => {
    const a = await seedTwoSubscriptions();
    const b = await seedTwoSubscriptions();
    await run(a, paddleAdapter, paddle('adjustment-created-refund-approved', at(5)));
    expect(await states(a)).toEqual({ pro: 'revoked', team: 'active' });
    expect(await states(b)).toEqual({ pro: 'active', team: 'active' });
  });

  it('revokes nothing when a one-off transaction is fully refunded', async () => {
    const seed = await seedTwoSubscriptions();
    await run(
      seed,
      paddleAdapter,
      paddle('transaction-completed', at(6), (d) => (d['id'] = 'txn_01k0000000000000000000000c')),
    );
    await run(
      seed,
      paddleAdapter,
      paddle('adjustment-created-refund-approved', at(7), (d) => {
        d['transaction_id'] = 'txn_01k0000000000000000000000c';
      }),
    );
    expect(await states(seed)).toEqual({ pro: 'active', team: 'active' });
  });
});

describe('paypal derived entitlements', () => {
  it('grants from plan_id and expires on subscription expiry', async () => {
    const seed = await seedMapped('paypal', 'P-SANDBOXPLAN001');
    const event = (name: string, id: string, createTime: string) => ({
      ...loadPayPalFixture(name),
      id,
      create_time: createTime,
    });
    await run(seed, paypalAdapter, event('subscription-activated', 'WH-A', '2026-10-01T10:00:00Z'));
    expect(await pro(seed)).toMatchObject({ state: 'active' });
    await run(seed, paypalAdapter, event('subscription-expired', 'WH-B', '2026-10-02T10:00:00Z'));
    expect((await pro(seed))?.state).toBe('expired');
  });
});
