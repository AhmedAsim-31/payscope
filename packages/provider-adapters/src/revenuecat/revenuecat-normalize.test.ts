import { describe, expect, it } from 'vitest';
import { ProviderError } from '../provider-error';
import { loadRevenueCatFixture } from './revenuecat-fixtures';
import { normalizeRevenueCatEvent } from './revenuecat-normalize';

function withEvent(overrides: Record<string, unknown>): Record<string, unknown> {
  const fixture = loadRevenueCatFixture('initial-purchase');
  return { ...fixture, event: { ...(fixture['event'] as object), ...overrides } };
}

describe('normalizeRevenueCatEvent', () => {
  it.each([
    ['initial-purchase', 'INITIAL_PURCHASE', 'subscription.created', 'subscription', ['pro'], 999n],
    ['renewal', 'RENEWAL', 'subscription.renewed', 'subscription', ['pro'], 999n],
    ['cancellation-unsubscribe', 'CANCELLATION', 'subscription.canceled', 'subscription', [], 999n],
    ['cancellation-refund', 'CANCELLATION', 'payment.refunded', 'payment', ['pro'], 999n],
    ['uncancellation', 'UNCANCELLATION', 'subscription.updated', 'subscription', [], 999n],
    ['expiration', 'EXPIRATION', 'subscription.expired', 'subscription', ['pro'], 0n],
    ['billing-issue', 'BILLING_ISSUE', 'payment.failed', 'subscription', [], 999n],
    ['product-change', 'PRODUCT_CHANGE', 'subscription.updated', 'subscription', [], 999n],
    ['non-renewing-purchase', 'NON_RENEWING_PURCHASE', 'payment.succeeded', 'payment', [], 499n],
  ] as const)('maps %s', (name, eventType, normalizedType, objectType, entitlementKeys, amount) => {
    const event = normalizeRevenueCatEvent(loadRevenueCatFixture(name));
    expect(event).toMatchObject({
      provider: 'revenuecat',
      eventType,
      normalizedType,
      objectType,
      entitlementKeys,
      amountMinor: amount,
      currency: 'USD',
      providerCustomerId: 'user_sandbox_001',
    });
    expect(event.providerEventId).toMatch(/^f0000000-/);
  });

  it('uses original_transaction_id as the object id and event_timestamp_ms as occurredAt', () => {
    const event = normalizeRevenueCatEvent(loadRevenueCatFixture('renewal'));
    expect(event.objectId).toBe('txn_sandbox_0001');
    expect(event.occurredAt).toEqual(new Date(1760000300100));
  });

  it('falls back to transaction_id, then the event id', () => {
    const noOriginal = withEvent({ original_transaction_id: null });
    expect(normalizeRevenueCatEvent(noOriginal).objectId).toBe('txn_sandbox_0001');
    const noIds = withEvent({ original_transaction_id: null, transaction_id: null });
    expect(normalizeRevenueCatEvent(noIds).objectId).toBe('f0000000-0000-4000-8000-000000000001');
  });

  it.each(['test', 'subscription-paused'])('marks %s as unsupported', (name) => {
    const event = normalizeRevenueCatEvent(loadRevenueCatFixture(name));
    expect(event.normalizedType).toBe('unsupported');
    expect(event.entitlementKeys).toEqual([]);
  });

  it('rejects PRODUCTION events as invalid_input', () => {
    const run = () => normalizeRevenueCatEvent(loadRevenueCatFixture('production-renewal'));
    expect(run).toThrow(ProviderError);
    expect(run).toThrow(/sandbox/i);
    try {
      run();
    } catch (error) {
      expect((error as ProviderError).category).toBe('invalid_input');
      expect((error as ProviderError).reason).toBe('live_mode');
    }
  });

  it('rejects malformed envelopes', () => {
    expect(() => normalizeRevenueCatEvent({ event: { id: 'x' } })).toThrow(ProviderError);
    expect(() => normalizeRevenueCatEvent('nope')).toThrow(ProviderError);
  });

  it.each([
    [9.99, 'USD', 999n, false],
    [0.99, 'USD', 99n, false],
    [500, 'JPY', 500n, false],
    [0.99, 'JPY', null, true],
    [4.999, 'USD', null, true],
    [1e-7, 'USD', null, true],
  ])('converts price %s %s to %s without float math', (price, currency, minor, keepsRaw) => {
    const event = normalizeRevenueCatEvent(
      withEvent({ price_in_purchased_currency: price, currency }),
    );
    expect(event.amountMinor).toBe(minor);
    expect(event.metadata?.['priceRaw'] !== undefined).toBe(keepsRaw);
  });

  it('keeps amount null when the price or currency is absent', () => {
    const noPrice = normalizeRevenueCatEvent(withEvent({ price_in_purchased_currency: null }));
    expect(noPrice.amountMinor).toBeNull();
    const noCurrency = normalizeRevenueCatEvent(withEvent({ currency: null }));
    expect(noCurrency).toMatchObject({ amountMinor: null, currency: null });
  });

  it('reports a refund as a positive amount', () => {
    const event = normalizeRevenueCatEvent(loadRevenueCatFixture('cancellation-refund'));
    expect(event.amountMinor).toBe(999n);
  });
});
