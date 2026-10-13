import { stripeAdapter } from '@payscope/provider-adapters/stripe/stripe-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { createDb } from '../db/client';
import { createProcessProviderEventHandler } from '../jobs/handlers/process-provider-event';
import {
  attemptRows,
  eventRow,
  registry,
  seedConnection,
  silent,
  storeEvent,
  stripe,
  payments,
  type Seed,
} from '../test/event-harness';
import { parkQueuedJobs } from '../test/job-fixtures';
import { TEST_DATABASE_URL } from '../test/test-database-url';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 10 });
const handler = createProcessProviderEventHandler(registry);
const ctx = { db, logger: silent, workerId: 'test' };

beforeAll(() => parkQueuedJobs(sql));
afterAll(() => sql.end({ timeout: 1 }));

async function run(seed: Seed, adapter: ProviderAdapter, payload: Record<string, unknown>) {
  const stored = await storeEvent(sql, seed, adapter, payload);
  await handler(stored.job, ctx);
  return stored;
}

describe('stripe payments', () => {
  it('creates customer, mapping and a succeeded payment', async () => {
    const seed = await seedConnection(sql, 'stripe');
    const stored = await run(seed, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    const [payment] = await payments(sql, seed);
    expect(payment).toMatchObject({
      status: 'succeeded',
      amount_minor: '4999',
      currency: 'USD',
      version: 0,
    });
    const [mapping] = await sql<{ customer_id: string }[]>`
      select customer_id from provider_customer_mappings
      where connection_id = ${seed.connectionId} and provider_customer_id = 'cus_test_Nx81aB'`;
    expect(mapping?.customer_id).toBe(payment?.customer_id);
    expect((await eventRow(sql, stored.eventId))?.status).toBe('processed');
    expect(await attemptRows(sql, stored.eventId)).toMatchObject([{ outcome: 'succeeded' }]);
  });

  it('marks a partial refund after success as partially_refunded', async () => {
    const seed = await seedConnection(sql, 'stripe');
    await run(seed, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    await run(seed, stripeAdapter, stripe('charge-refunded', 1760000003));
    const [payment] = await payments(sql, seed);
    expect(payment).toMatchObject({
      status: 'partially_refunded',
      amount_minor: '4999',
      amount_refunded_minor: '1500',
      version: 1,
    });
  });

  it('marks a full refund as refunded without touching the amount', async () => {
    const seed = await seedConnection(sql, 'stripe');
    await run(seed, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    await run(
      seed,
      stripeAdapter,
      stripe('charge-refunded', 1760000003, (o) => (o['amount_refunded'] = 4999)),
    );
    const [payment] = await payments(sql, seed);
    expect(payment).toMatchObject({
      status: 'refunded',
      amount_minor: '4999',
      amount_refunded_minor: '4999',
    });
  });

  it('defers a refund that arrives before its payment instead of inventing the amount', async () => {
    const seed = await seedConnection(sql, 'stripe');
    const refund = await storeEvent(
      sql,
      seed,
      stripeAdapter,
      stripe('charge-refunded', 1760000500),
    );
    await expect(handler(refund.job, ctx)).rejects.toThrow('refund_payment_unknown');
    expect(await payments(sql, seed)).toHaveLength(0);
    expect((await eventRow(sql, refund.eventId))?.status).toBe('failed');
    expect(await attemptRows(sql, refund.eventId)).toMatchObject([
      { outcome: 'failed', failure_category: 'transient' },
    ]);

    await run(seed, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    await handler({ ...refund.job, attemptCount: 2 }, ctx);
    expect((await payments(sql, seed))[0]).toMatchObject({
      status: 'partially_refunded',
      amount_minor: '4999',
      amount_refunded_minor: '1500',
      version: 1,
    });
    expect((await eventRow(sql, refund.eventId))?.status).toBe('processed');

    const late = await run(seed, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    expect((await payments(sql, seed))[0]).toMatchObject({ status: 'partially_refunded' });
    expect((await eventRow(sql, late.eventId))?.status).toBe('ignored');
  });

  it('applies a concurrent duplicate run once', async () => {
    const seed = await seedConnection(sql, 'stripe');
    await run(seed, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    const refund = await storeEvent(
      sql,
      seed,
      stripeAdapter,
      stripe('charge-refunded', 1760000003),
    );
    await Promise.all([handler(refund.job, ctx), handler(refund.job, ctx)]);
    const rows = await payments(sql, seed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, status: 'partially_refunded' });
    expect(await attemptRows(sql, refund.eventId)).toHaveLength(1);
  });

  it('records a dispute on a known payment and notes an unknown one without orphan rows', async () => {
    const seed = await seedConnection(sql, 'stripe');
    const orphan = await run(seed, stripeAdapter, stripe('charge-dispute-created', 1760000010));
    expect(await payments(sql, seed)).toHaveLength(0);
    expect((await eventRow(sql, orphan.eventId))?.status).toBe('processed');
    expect(await attemptRows(sql, orphan.eventId)).toMatchObject([
      { outcome: 'succeeded', error_message: 'dispute_payment_unknown' },
    ]);
    await run(
      seed,
      stripeAdapter,
      stripe('payment-intent-succeeded', 1760000001, (o) => (o['id'] = 'pi_test_dispute')),
    );
    await run(
      seed,
      stripeAdapter,
      stripe(
        'charge-dispute-created',
        1760000020,
        (o) => (o['payment_intent'] = 'pi_test_dispute'),
      ),
    );
    expect((await payments(sql, seed))[0]).toMatchObject({ status: 'disputed' });
  });
});

describe('isolation', () => {
  it('never touches another org that shares provider ids', async () => {
    const a = await seedConnection(sql, 'stripe');
    const b = await seedConnection(sql, 'stripe');
    await run(a, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    await run(b, stripeAdapter, stripe('payment-intent-succeeded', 1760000001));
    await run(
      a,
      stripeAdapter,
      stripe('charge-refunded', 1760000003, (o) => (o['amount_refunded'] = 4999)),
    );
    expect((await payments(sql, a))[0]?.status).toBe('refunded');
    expect((await payments(sql, b))[0]).toMatchObject({ status: 'succeeded', version: 0 });
    const [customers] = await sql<{ n: number }[]>`
      select count(distinct customer_id)::int as n from payment_records where org_id in (${a.orgId}, ${b.orgId})`;
    expect(customers?.n).toBe(2);
  });
});
