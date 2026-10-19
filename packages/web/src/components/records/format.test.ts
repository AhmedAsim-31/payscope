import { describe, expect, it } from 'vitest';
import { formatAge, formatDuration, formatMoney, formatTimestamp, humanize } from './format';

describe('formatMoney', () => {
  it('formats a bigint string beyond 2^53 exactly', () => {
    expect(formatMoney({ amountMinor: '9007199254740993123', currency: 'USD' })).toBe(
      '90071992547409931.23 USD',
    );
  });

  it('respects zero-decimal currencies', () => {
    expect(formatMoney({ amountMinor: '1234', currency: 'JPY' })).toBe('1234 JPY');
  });

  it('respects three-decimal currencies', () => {
    expect(formatMoney({ amountMinor: '1234567', currency: 'BHD' })).toBe('1234.567 BHD');
    expect(formatMoney({ amountMinor: '5', currency: 'BHD' })).toBe('0.005 BHD');
  });

  it('pads small two-decimal amounts', () => {
    expect(formatMoney({ amountMinor: '7', currency: 'EUR' })).toBe('0.07 EUR');
  });
});

describe('formatTimestamp', () => {
  it('renders UTC with an explicit zone label', () => {
    expect(formatTimestamp('2026-03-05T14:07:09.000Z')).toBe('5 Mar 2026, 14:07:09 UTC');
  });
});

describe('humanize', () => {
  it('turns enum values into sentence case', () => {
    expect(humanize('partially_refunded')).toBe('Partially refunded');
  });

  it('uses brand display names for provider ids', () => {
    expect(humanize('revenuecat')).toBe('RevenueCat');
    expect(humanize('paypal')).toBe('PayPal');
    expect(humanize('stripe')).toBe('Stripe');
  });
});

describe('formatDuration and formatAge', () => {
  it('formats short and long spans', () => {
    expect(formatDuration(240)).toBe('240 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatAge(45)).toBe('45s');
    expect(formatAge(125)).toBe('2m 5s');
    expect(formatAge(7500)).toBe('2h 5m');
  });
});
