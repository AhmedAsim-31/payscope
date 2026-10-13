import { describe, expect, it } from 'vitest';
import type { NormalizedEventType } from '../normalized-event';
import { NormalizedEventSchema } from '../normalized-event';
import { ProviderError } from '../provider-error';
import { loadPayPalFixture } from './paypal-fixtures';
import { normalizePayPalEvent } from './paypal-normalize';

type Row = [string, NormalizedEventType, string, string, bigint | null, string | null];

const rows: Row[] = [
  ['capture-completed', 'payment.succeeded', 'payment', '5SANDBOXCAPTURE001', 2499n, 'USD'],
  ['capture-denied', 'payment.failed', 'payment', '5SANDBOXCAPTURE001', 2499n, 'USD'],
  ['capture-refunded', 'payment.refunded', 'payment', '5SANDBOXCAPTURE001', 1050n, 'USD'],
  ['capture-reversed', 'payment.disputed', 'payment', '5SANDBOXCAPTURE001', 1050n, 'USD'],
  ['dispute-created', 'payment.disputed', 'dispute', 'PP-D-SANDBOX001', 2499n, 'USD'],
  ['dispute-resolved', 'dispute.closed', 'dispute', 'PP-D-SANDBOX001', 2499n, 'USD'],
  ['subscription-created', 'subscription.created', 'subscription', 'I-SANDBOX0000001', null, null],
  [
    'subscription-activated',
    'subscription.created',
    'subscription',
    'I-SANDBOX0000001',
    null,
    null,
  ],
  ['subscription-updated', 'subscription.updated', 'subscription', 'I-SANDBOX0000001', null, null],
  [
    'subscription-suspended',
    'subscription.updated',
    'subscription',
    'I-SANDBOX0000001',
    null,
    null,
  ],
  [
    'subscription-cancelled',
    'subscription.canceled',
    'subscription',
    'I-SANDBOX0000001',
    null,
    null,
  ],
  ['subscription-expired', 'subscription.expired', 'subscription', 'I-SANDBOX0000001', null, null],
  [
    'subscription-payment-failed',
    'payment.failed',
    'subscription',
    'I-SANDBOX0000001',
    999n,
    'USD',
  ],
  [
    'sale-completed-subscription',
    'subscription.renewed',
    'subscription',
    'I-SANDBOX0000001',
    999n,
    'USD',
  ],
  ['sale-completed-standalone', 'unsupported', 'other', '3SANDBOXSALE00002', null, null],
  ['unsupported-order-approved', 'unsupported', 'other', '7SANDBOXORDER001', null, null],
];

describe('normalizePayPalEvent', () => {
  it.each(rows)('%s -> %s', (name, type, objectType, objectId, amount, currency) => {
    const event = normalizePayPalEvent(loadPayPalFixture(name));
    expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      provider: 'paypal',
      normalizedType: type,
      objectType,
      objectId,
      amountMinor: amount,
      currency,
      occurredAt: new Date('2026-10-01T10:00:00Z'),
    });
  });

  it('keeps the refund id and order id as metadata', () => {
    expect(normalizePayPalEvent(loadPayPalFixture('capture-refunded')).metadata).toEqual({
      refundId: '1SANDBOXREFUND001',
    });
    expect(normalizePayPalEvent(loadPayPalFixture('capture-completed')).metadata).toEqual({
      orderId: '7SANDBOXORDER001',
    });
  });

  it('carries a billing agreement id on a capture as its subscription', () => {
    const fixture = loadPayPalFixture('capture-completed');
    const resource = {
      ...(fixture['resource'] as object),
      billing_agreement_id: 'I-SANDBOXSUB001',
    };
    expect(normalizePayPalEvent({ ...fixture, resource }).metadata).toMatchObject({
      subscriptionId: 'I-SANDBOXSUB001',
    });
  });

  it('falls back to the refund id when no capture link exists', () => {
    const fixture = loadPayPalFixture('capture-refunded');
    const resource = { ...(fixture['resource'] as object), links: [] };
    const event = normalizePayPalEvent({ ...fixture, resource });
    expect(event.objectId).toBe('1SANDBOXREFUND001');
    expect(event.metadata).toEqual({ refundId: '1SANDBOXREFUND001' });
  });

  it('parses zero-decimal currencies and rejects excess precision', () => {
    const fixture = loadPayPalFixture('capture-completed');
    const withAmount = (value: string, currency_code: string) => ({
      ...fixture,
      resource: { ...(fixture['resource'] as object), amount: { currency_code, value } },
    });
    expect(normalizePayPalEvent(withAmount('1500', 'JPY')).amountMinor).toBe(1500n);
    expect(() => normalizePayPalEvent(withAmount('10.999', 'USD'))).toThrow(ProviderError);
    expect(() => normalizePayPalEvent(withAmount('abc', 'USD'))).toThrow(ProviderError);
    expect(() => normalizePayPalEvent(withAmount('1e3', 'USD'))).toThrow(ProviderError);
  });

  it('rejects an invalid envelope', () => {
    expect(() => normalizePayPalEvent({ id: 'WH-1' })).toThrow(ProviderError);
    expect(() => normalizePayPalEvent(null)).toThrow(ProviderError);
  });
});
