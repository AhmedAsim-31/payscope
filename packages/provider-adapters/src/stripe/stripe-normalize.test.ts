import { describe, expect, it } from 'vitest';
import type { NormalizedEventType } from '../normalized-event';
import { ProviderError } from '../provider-error';
import { loadStripeFixture } from './stripe-fixtures';
import { normalizeStripeEvent } from './stripe-normalize';

type Row = {
  fixture: string;
  normalizedType: NormalizedEventType;
  objectType: string;
  objectId: string;
  amountMinor: bigint | null;
  currency: string | null;
  customer: string | null;
};

const CUS = 'cus_test_Nx81aB';
const rows: Row[] = [
  {
    fixture: 'payment-intent-succeeded',
    normalizedType: 'payment.succeeded',
    objectType: 'payment',
    objectId: 'pi_test_3Qa1b2c3d4',
    amountMinor: 4999n,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'payment-intent-payment-failed',
    normalizedType: 'payment.failed',
    objectType: 'payment',
    objectId: 'pi_test_3Qa1b2c3d4',
    amountMinor: 4999n,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'charge-refunded',
    normalizedType: 'payment.refunded',
    objectType: 'payment',
    objectId: 'pi_test_3Qa1b2c3d4',
    amountMinor: 1500n,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'charge-dispute-created',
    normalizedType: 'payment.disputed',
    objectType: 'dispute',
    objectId: 'dp_test_1Rt5kLm',
    amountMinor: 4999n,
    currency: 'USD',
    customer: null,
  },
  {
    fixture: 'charge-dispute-closed',
    normalizedType: 'dispute.closed',
    objectType: 'dispute',
    objectId: 'dp_test_1Rt5kLm',
    amountMinor: 4999n,
    currency: 'USD',
    customer: null,
  },
  {
    fixture: 'customer-subscription-created',
    normalizedType: 'subscription.created',
    objectType: 'subscription',
    objectId: 'sub_test_1Pq9zXy',
    amountMinor: null,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'customer-subscription-updated',
    normalizedType: 'subscription.updated',
    objectType: 'subscription',
    objectId: 'sub_test_1Pq9zXy',
    amountMinor: null,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'customer-subscription-updated-canceled',
    normalizedType: 'subscription.canceled',
    objectType: 'subscription',
    objectId: 'sub_test_1Pq9zXy',
    amountMinor: null,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'customer-subscription-deleted',
    normalizedType: 'subscription.expired',
    objectType: 'subscription',
    objectId: 'sub_test_1Pq9zXy',
    amountMinor: null,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'invoice-paid-subscription-cycle',
    normalizedType: 'subscription.renewed',
    objectType: 'subscription',
    objectId: 'sub_test_1Pq9zXy',
    amountMinor: 1999n,
    currency: 'USD',
    customer: CUS,
  },
  {
    fixture: 'invoice-paid-subscription-create',
    normalizedType: 'unsupported',
    objectType: 'other',
    objectId: 'in_test_1Su7vWy',
    amountMinor: null,
    currency: null,
    customer: null,
  },
  {
    fixture: 'unsupported-customer-created',
    normalizedType: 'unsupported',
    objectType: 'other',
    objectId: CUS,
    amountMinor: null,
    currency: null,
    customer: null,
  },
];

describe('normalizeStripeEvent', () => {
  it.each(rows)('maps $fixture', (row) => {
    const raw = loadStripeFixture(row.fixture);
    const event = normalizeStripeEvent(raw);
    expect(event).toMatchObject({
      provider: 'stripe',
      providerEventId: raw['id'],
      eventType: raw['type'],
      normalizedType: row.normalizedType,
      objectType: row.objectType,
      objectId: row.objectId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      providerCustomerId: row.customer,
    });
    expect(event.occurredAt).toEqual(new Date((raw['created'] as number) * 1000));
  });

  it('uses amount_received for succeeded payments', () => {
    const raw = loadStripeFixture('payment-intent-succeeded');
    const object = (raw['data'] as { object: Record<string, unknown> }).object;
    object['amount_received'] = 3000;
    expect(normalizeStripeEvent(raw).amountMinor).toBe(3000n);
  });

  it('falls back to the charge id when a refund has no payment intent', () => {
    const raw = loadStripeFixture('charge-refunded');
    (raw['data'] as { object: Record<string, unknown> }).object['payment_intent'] = null;
    expect(normalizeStripeEvent(raw).objectId).toBe('ch_test_3Qa1b2c3d4');
  });

  it('reads current_period_end from subscription items', () => {
    const event = normalizeStripeEvent(loadStripeFixture('customer-subscription-created'));
    expect(event.metadata).toMatchObject({ currentPeriodEnd: 1_762_592_000 });
  });

  it('rejects live-mode events', () => {
    const attempt = () =>
      normalizeStripeEvent(loadStripeFixture('livemode-payment-intent-succeeded'));
    expect(attempt).toThrow(ProviderError);
    expect(attempt).toThrow(/live-mode/i);
  });

  it('rejects float amounts', () => {
    const raw = loadStripeFixture('payment-intent-succeeded');
    (raw['data'] as { object: Record<string, unknown> }).object['amount'] = 49.99;
    expect(() => normalizeStripeEvent(raw)).toThrow(ProviderError);
  });

  it('rejects a malformed envelope with invalid_input', () => {
    for (const bad of [null, 'x', {}, { id: 'evt_1', type: 'x', created: 1, livemode: false }]) {
      try {
        normalizeStripeEvent(bad);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).category).toBe('invalid_input');
      }
    }
  });
});
