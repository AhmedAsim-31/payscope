import { describe, expect, it } from 'vitest';
import { NormalizedEventSchema } from './normalized-event';

const valid = {
  provider: 'stripe',
  providerEventId: 'evt_1',
  eventType: 'payment_intent.succeeded',
  normalizedType: 'payment.succeeded',
  occurredAt: new Date('2026-01-01T00:00:00Z'),
  objectType: 'payment',
  objectId: 'pi_1',
  providerCustomerId: null,
  amountMinor: 1999n,
  currency: 'USD',
  status: 'succeeded',
  entitlementKeys: [],
  metadata: null,
};

describe('NormalizedEventSchema', () => {
  it('accepts a bigint amount', () => {
    expect(NormalizedEventSchema.parse(valid).amountMinor).toBe(1999n);
  });

  it('accepts null amount and currency', () => {
    expect(() =>
      NormalizedEventSchema.parse({ ...valid, amountMinor: null, currency: null }),
    ).not.toThrow();
  });

  it('rejects lowercase currency', () => {
    expect(NormalizedEventSchema.safeParse({ ...valid, currency: 'usd' }).success).toBe(false);
  });

  it('rejects a float amount', () => {
    expect(NormalizedEventSchema.safeParse({ ...valid, amountMinor: 19.99 }).success).toBe(false);
  });

  it('rejects a number amount even when integral', () => {
    expect(NormalizedEventSchema.safeParse({ ...valid, amountMinor: 1999 }).success).toBe(false);
  });

  it('rejects an unknown normalized type', () => {
    expect(NormalizedEventSchema.safeParse({ ...valid, normalizedType: 'nope' }).success).toBe(
      false,
    );
  });
});
