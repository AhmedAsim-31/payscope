import { randomUUID } from 'node:crypto';
import { paddleAdapter } from '@payscope/provider-adapters/paddle/paddle-adapter';
import { paypalAdapter } from '@payscope/provider-adapters/paypal/paypal-adapter';
import { loadPayPalFixture } from '@payscope/provider-adapters/paypal/paypal-fixtures';
import { revenueCatAdapter } from '@payscope/provider-adapters/revenuecat/revenuecat-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { createDb } from '../db/client';
import { createProcessProviderEventHandler } from '../jobs/handlers/process-provider-event';
import {
  eventRow,
  paddle,
  registry,
  revenueCat,
  seedConnection,
  silent,
  storeEvent,
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

describe('subscriptions and entitlements', () => {
  it('updates the subscription and period on a Paddle renewal', async () => {
    const seed = await seedConnection(sql, 'paddle');
    await run(seed, paddleAdapter, paddle('subscription-created'));
    await run(seed, paddleAdapter, paddle('transaction-completed-recurring'));
    await run(
      seed,
      paddleAdapter,
      paddle('subscription-updated', '2026-11-02T00:00:00.000000Z', (d) => {
        d['status'] = 'active';
        d['current_billing_period'] = {
          starts_at: '2026-11-01T10:00:00Z',
          ends_at: '2026-12-01T10:00:00Z',
        };
      }),
    );
    const [sub] = await sql<{ status: string; version: number; current_period_end: Date }[]>`
      select status, version, current_period_end from subscription_records where connection_id = ${seed.connectionId}`;
    expect(sub?.version).toBe(2);
    expect(sub?.status).toBe('active');
    expect(new Date(sub?.current_period_end ?? 0).toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });

  it('grants, keeps on cancellation, expires and revokes RevenueCat entitlements', async () => {
    const seed = await seedConnection(sql, 'revenuecat');
    const state = async () => {
      const [row] = await sql<{ state: string; source: string }[]>`
        select state, source from entitlement_records where org_id = ${seed.orgId} and entitlement_key = 'pro'`;
      return row;
    };
    await run(seed, revenueCatAdapter, revenueCat('initial-purchase', 1760000000100));
    expect(await state()).toEqual({ state: 'active', source: 'provider_event' });
    await run(seed, revenueCatAdapter, revenueCat('cancellation-unsubscribe', 1760000100100));
    expect((await state())?.state).toBe('active');
    const [sub] = await sql<{ status: string; cancel_at_period_end: boolean }[]>`
      select status, cancel_at_period_end from subscription_records where connection_id = ${seed.connectionId}`;
    expect(sub).toEqual({ status: 'canceled', cancel_at_period_end: true });
    await run(seed, revenueCatAdapter, revenueCat('expiration', 1760000400100));
    expect((await state())?.state).toBe('expired');
    await run(seed, revenueCatAdapter, revenueCat('cancellation-refund', 1760000500100));
    expect((await state())?.state).toBe('revoked');
  });

  it('ignores an older entitlement grant that arrives after expiration', async () => {
    const seed = await seedConnection(sql, 'revenuecat');
    await run(seed, revenueCatAdapter, revenueCat('expiration', 1760000400100));
    const late = await run(seed, revenueCatAdapter, revenueCat('initial-purchase', 1760000000100));
    const [row] = await sql<{ state: string }[]>`
      select state from entitlement_records where org_id = ${seed.orgId}`;
    expect(row?.state).toBe('expired');
    expect((await eventRow(sql, late.eventId))?.status).toBe('ignored');
  });
});

describe('paypal', () => {
  it('creates a payment from a decimal string amount', async () => {
    const seed = await seedConnection(sql, 'paypal');
    const payload = { ...loadPayPalFixture('capture-completed'), id: `WH-${randomUUID()}` };
    await run(seed, paypalAdapter, payload);
    expect((await payments(sql, seed))[0]).toMatchObject({
      provider_payment_id: '5SANDBOXCAPTURE001',
      amount_minor: '2499',
      status: 'succeeded',
    });
  });
});
