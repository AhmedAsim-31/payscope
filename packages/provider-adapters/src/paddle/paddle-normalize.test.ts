import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NormalizedEventType } from '../normalized-event';
import { NormalizedEventSchema } from '../normalized-event';
import { ProviderError } from '../provider-error';
import { normalizePaddleEvent } from './paddle-normalize';

const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

type Row = [string, NormalizedEventType, string, string, bigint | null];

const rows: Row[] = [
  [
    'transaction-completed',
    'payment.succeeded',
    'payment',
    'txn_01k00000000000000000000001',
    2499n,
  ],
  ['transaction-paid', 'payment.succeeded', 'payment', 'txn_01k00000000000000000000001', 2499n],
  [
    'transaction-completed-subscription-first',
    'payment.succeeded',
    'payment',
    'txn_01k00000000000000000000001',
    2499n,
  ],
  [
    'transaction-completed-recurring',
    'subscription.renewed',
    'subscription',
    'sub_01k00000000000000000000001',
    2499n,
  ],
  [
    'transaction-payment-failed',
    'payment.failed',
    'payment',
    'txn_01k00000000000000000000001',
    2499n,
  ],
  [
    'adjustment-created-refund-approved',
    'payment.refunded',
    'payment',
    'txn_01k00000000000000000000001',
    2499n,
  ],
  [
    'adjustment-updated-refund-approved',
    'payment.refunded',
    'payment',
    'txn_01k00000000000000000000001',
    2499n,
  ],
  [
    'adjustment-created-chargeback',
    'payment.disputed',
    'dispute',
    'adj_01k00000000000000000000001',
    2499n,
  ],
  [
    'subscription-created',
    'subscription.created',
    'subscription',
    'sub_01k00000000000000000000001',
    null,
  ],
  [
    'subscription-activated',
    'subscription.created',
    'subscription',
    'sub_01k00000000000000000000001',
    null,
  ],
  [
    'subscription-updated',
    'subscription.updated',
    'subscription',
    'sub_01k00000000000000000000001',
    null,
  ],
  [
    'subscription-canceled',
    'subscription.canceled',
    'subscription',
    'sub_01k00000000000000000000001',
    null,
  ],
  [
    'subscription-past-due',
    'subscription.updated',
    'subscription',
    'sub_01k00000000000000000000001',
    null,
  ],
  [
    'subscription-paused',
    'subscription.updated',
    'subscription',
    'sub_01k00000000000000000000001',
    null,
  ],
  [
    'subscription-resumed',
    'subscription.updated',
    'subscription',
    'sub_01k00000000000000000000001',
    null,
  ],
  [
    'adjustment-created-refund-pending',
    'unsupported',
    'other',
    'adj_01k00000000000000000000001',
    null,
  ],
  ['unsupported-customer-created', 'unsupported', 'other', 'ctm_01k00000000000000000000001', null],
];

describe('normalizePaddleEvent', () => {
  it.each(rows)('%s -> %s', (fixture, type, objectType, objectId, amount) => {
    const payload = load(fixture);
    const event = normalizePaddleEvent(payload);
    expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      provider: 'paddle',
      providerEventId: payload['event_id'],
      eventType: payload['event_type'],
      normalizedType: type,
      objectType,
      objectId,
      amountMinor: amount,
    });
  });

  it('keeps provider time, customer, currency and status', () => {
    const event = normalizePaddleEvent(load('transaction-completed'));
    expect(event.occurredAt.toISOString()).toBe('2026-10-01T10:00:06.123Z');
    expect(event.providerCustomerId).toBe('ctm_01k00000000000000000000001');
    expect(event.currency).toBe('USD');
    expect(event.status).toBe('completed');
  });

  it('uppercases the currency', () => {
    const payload = load('transaction-completed');
    (payload['data'] as Record<string, unknown>)['currency_code'] = 'eur';
    expect(normalizePaddleEvent(payload).currency).toBe('EUR');
  });

  it('reads the current billing period end on a subscription event', () => {
    const event = normalizePaddleEvent(load('subscription-created'));
    expect(event.metadata).toEqual({ currentPeriodEnd: '2026-11-01T10:00:00.000000Z' });
  });

  it('records the transaction on a renewal', () => {
    const event = normalizePaddleEvent(load('transaction-completed-recurring'));
    expect(event.metadata).toMatchObject({ transactionId: 'txn_01k00000000000000000000001' });
  });

  it('links a refund to its adjustment and a chargeback to its transaction', () => {
    expect(normalizePaddleEvent(load('adjustment-created-refund-approved')).metadata).toMatchObject(
      { adjustmentId: 'adj_01k00000000000000000000001' },
    );
    expect(normalizePaddleEvent(load('adjustment-created-chargeback')).metadata).toMatchObject({
      transactionId: 'txn_01k00000000000000000000001',
    });
  });

  it('does not require a mapped data shape for unsupported events', () => {
    const payload = load('unsupported-customer-created');
    payload['event_type'] = 'product.created';
    payload['data'] = { name: 'no id here' };
    const event = normalizePaddleEvent(payload);
    expect(event.normalizedType).toBe('unsupported');
    expect(event.objectId).toBe(payload['event_id']);
  });

  it.each(['10.5', '', '1e3'])('rejects amount %j as invalid_input', (bad) => {
    const payload = load('transaction-completed');
    const data = payload['data'] as { details: { totals: Record<string, string> } };
    data.details.totals['grand_total'] = bad;
    expect(() => normalizePaddleEvent(payload)).toThrow(ProviderError);
    expect(() => normalizePaddleEvent(payload)).toThrow(/minor-unit|invalid/i);
  });

  it('rejects a malformed envelope or a mapped event missing required fields', () => {
    expect(() => normalizePaddleEvent(null)).toThrow(ProviderError);
    expect(() => normalizePaddleEvent({ event_id: 'evt_1' })).toThrow(ProviderError);
    const bad = load('transaction-completed');
    bad['occurred_at'] = 'yesterday';
    expect(() => normalizePaddleEvent(bad)).toThrow(ProviderError);
    const noId = load('transaction-completed');
    noId['data'] = { status: 'completed' };
    expect(() => normalizePaddleEvent(noId)).toThrow(ProviderError);
  });
});
