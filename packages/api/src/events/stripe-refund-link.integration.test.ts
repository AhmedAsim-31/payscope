import { randomBytes } from 'node:crypto';
import { stripeAdapter } from '@payscope/provider-adapters/stripe/stripe-adapter';
import { loadStripeFixture } from '@payscope/provider-adapters/stripe/stripe-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import { createDb } from '../db/client';
import { createProcessProviderEventHandler } from '../jobs/handlers/process-provider-event';
import {
  eventRow,
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
const cipher = createCredentialsCipher(randomBytes(32));
const ctx = { db, logger: silent, workerId: 'test' };

const PI = 'pi_test_3Qa1b2c3d4';
const SUB_PRO = 'sub_test_1Pq9zXy';
const SUB_TEAM = 'sub_test_2Tm4aBc';

let stripeDown = false;
const calls: string[] = [];
const fakeStripe: typeof fetch = (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  calls.push(url.searchParams.get('payment[payment_intent]') ?? '');
  if (stripeDown) return Promise.resolve(new Response('{}', { status: 503 }));
  const linked = url.searchParams.get('payment[payment_intent]') === PI;
  const body = linked
    ? loadStripeFixture('invoice-payments-list-expanded')
    : { object: 'list', url: '/v1/invoice_payments', has_more: false, data: [] };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
};
const handler = createProcessProviderEventHandler(registry, cipher, fakeStripe);

beforeAll(() => parkQueuedJobs(sql));
afterAll(() => sql.end({ timeout: 1 }));

async function seedStripe(): Promise<Seed> {
  const seed = await seedConnection(sql, 'stripe');
  const map = JSON.stringify({
    price_test_pro_monthly: ['pro'],
    price_test_team_monthly: ['team'],
  });
  const { ciphertext, keyVersion } = cipher.encrypt(
    { apiKey: 'sk_test_link', webhookSecrets: ['whsec_link'] },
    seed.connectionId,
  );
  await sql`update provider_connections
    set entitlement_map = ${map}::jsonb, credentials_ciphertext = ${ciphertext},
      credentials_key_version = ${keyVersion}
    where id = ${seed.connectionId}`;
  return seed;
}

async function run(seed: Seed, payload: Record<string, unknown>) {
  const stored = await storeEvent(sql, seed, stripeAdapter, payload);
  await handler(stored.job, ctx);
  return stored;
}

const subscription = (id: string, price: string) => (o: Obj) => {
  o['id'] = id;
  o['status'] = 'active';
  o['items'] = { data: [{ current_period_end: 1765000000, price: { id: price } }] };
};

const steps = {
  subscriptions: async (seed: Seed) => {
    await run(
      seed,
      stripe(
        'customer-subscription-created',
        1760000002,
        subscription(SUB_PRO, 'price_test_pro_monthly'),
      ),
    );
    await run(
      seed,
      stripe(
        'customer-subscription-created',
        1760000003,
        subscription(SUB_TEAM, 'price_test_team_monthly'),
      ),
    );
  },
  invoice: (seed: Seed) => run(seed, stripe('invoice-paid-subscription-create', 1760000004)),
  payment: (seed: Seed) => run(seed, stripe('payment-intent-succeeded', 1760000005)),
};

const fullRefund = (seed: Seed, at = 1760000020) =>
  run(
    seed,
    stripe('charge-refunded', at, (o) => (o['amount_refunded'] = 4999)),
  );

async function states(seed: Seed) {
  const rows = await sql<{ entitlement_key: string; state: string }[]>`
    select entitlement_key, state from entitlement_records
    where org_id = ${seed.orgId} order by entitlement_key`;
  return Object.fromEntries(rows.map((r) => [r.entitlement_key, r.state]));
}

async function linkedSubscription(seed: Seed) {
  const [row] = await sql<{ provider_subscription_id: string | null }[]>`
    select provider_subscription_id from payment_records where connection_id = ${seed.connectionId}`;
  return row?.provider_subscription_id;
}

describe('stripe refund subscription link', () => {
  it.each([
    ['payment before invoice', ['payment', 'invoice', 'subscriptions']],
    ['invoice before payment', ['subscriptions', 'invoice', 'payment']],
  ] as const)('revokes only the paid subscription on a full refund (%s)', async (_label, order) => {
    const seed = await seedStripe();
    for (const step of order) await steps[step](seed);
    expect(await states(seed)).toEqual({ pro: 'active', team: 'active' });

    await fullRefund(seed);
    expect((await payments(sql, seed))[0]?.status).toBe('refunded');
    expect(await linkedSubscription(seed)).toBe(SUB_PRO);
    expect(await states(seed)).toEqual({ pro: 'revoked', team: 'active' });
  });

  it('leaves another org with the same payment id untouched', async () => {
    const a = await seedStripe();
    const b = await seedStripe();
    for (const seed of [a, b]) {
      await steps.subscriptions(seed);
      await steps.payment(seed);
    }
    await fullRefund(a);
    expect(await states(a)).toEqual({ pro: 'revoked', team: 'active' });
    expect(await states(b)).toEqual({ pro: 'active', team: 'active' });
    expect(await linkedSubscription(b)).toBeNull();
  });

  it('revokes nothing when the payment has no invoice payment', async () => {
    const seed = await seedStripe();
    await steps.subscriptions(seed);
    await run(
      seed,
      stripe('payment-intent-succeeded', 1760000005, (o) => (o['id'] = 'pi_one_off')),
    );
    await run(
      seed,
      stripe('charge-refunded', 1760000020, (o) => {
        o['payment_intent'] = 'pi_one_off';
        o['amount_refunded'] = 4999;
      }),
    );
    expect(await linkedSubscription(seed)).toBeNull();
    expect(await states(seed)).toEqual({ pro: 'active', team: 'active' });
  });

  it('fails the refund retryably while the lookup is unavailable, then revokes on retry', async () => {
    const seed = await seedStripe();
    await steps.subscriptions(seed);
    await steps.payment(seed);
    const stored = await storeEvent(
      sql,
      seed,
      stripeAdapter,
      stripe('charge-refunded', 1760000020, (o) => (o['amount_refunded'] = 4999)),
    );
    stripeDown = true;
    try {
      await expect(handler(stored.job, ctx)).rejects.toThrow();
    } finally {
      stripeDown = false;
    }
    expect((await eventRow(sql, stored.eventId))?.status).toBe('failed');
    expect(await states(seed)).toEqual({ pro: 'active', team: 'active' });

    await handler({ ...stored.job, attemptCount: 2 }, ctx);
    expect(await states(seed)).toEqual({ pro: 'revoked', team: 'active' });
  });

  it('skips the lookup once the payment is already linked', async () => {
    const seed = await seedStripe();
    await steps.subscriptions(seed);
    await steps.payment(seed);
    await run(
      seed,
      stripe('charge-refunded', 1760000010, (o) => (o['amount_refunded'] = 1000)),
    );
    expect(await linkedSubscription(seed)).toBe(SUB_PRO);
    calls.length = 0;
    await fullRefund(seed);
    expect(calls).toEqual([]);
    expect(await states(seed)).toEqual({ pro: 'revoked', team: 'active' });
  });
});
