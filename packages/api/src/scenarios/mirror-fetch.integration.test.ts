import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness } from '../test/identity-harness';
import { newTenant, type Tenant } from '../test/ops-harness';
import { addCustomer, addPayment, addSubscription } from '../test/reconciliation-fixtures';
import { createMirrorFetch } from './mirror-fetch';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  app = await harness.start();
  a = await newTenant(harness, app);
  b = await newTenant(harness, app);
});
afterAll(() => harness.stop());

async function statusOf(tenant: Tenant, url: string) {
  const res = await createMirrorFetch(harness.db, new Map(), tenant)(url);
  return ((await res.json()) as { status?: string }).status;
}

describe('mirror fetch scope', () => {
  it('reads a shared provider payment id only from its own org and connection', async () => {
    const providerId = `pi_shared_${Date.now()}`;
    await addPayment(sql, a, { providerId, status: 'succeeded' });
    await addPayment(sql, b, { providerId, status: 'canceled' });
    const url = `https://api.stripe.com/v1/payment_intents/${providerId}`;
    expect(await statusOf(a, url)).toBe('succeeded');
    expect(await statusOf(b, url)).toBe('canceled');
  });

  it('reads a shared provider subscription id only from its own org and connection', async () => {
    const providerId = `sub_shared_${Date.now()}`;
    for (const [tenant, status] of [
      [a, 'active'],
      [b, 'canceled'],
    ] as const) {
      const customerId = await addCustomer(sql, tenant);
      const id = await addSubscription(sql, tenant, customerId, status);
      await sql`update subscription_records set provider_subscription_id = ${providerId} where id = ${id}`;
    }
    const url = `https://api.stripe.com/v1/subscriptions/${providerId}`;
    expect(await statusOf(a, url)).toBe('active');
    expect(await statusOf(b, url)).toBe('canceled');
  });
});
