import { describe, expect, it } from 'vitest';
import { revenueCatPriceToMinor } from './revenuecat-amount';

describe('revenueCatPriceToMinor', () => {
  it.each([
    [9.99, 'USD', 999n],
    [0.99, 'USD', 99n],
    [0.1, 'USD', 10n],
    [19.9, 'USD', 1990n],
    [0, 'USD', 0n],
    [500, 'JPY', 500n],
    [1.5, 'KWD', 1500n],
    [-9.99, 'USD', -999n],
  ])('converts %s %s to %s', (price, currency, expected) => {
    expect(revenueCatPriceToMinor(price, currency)).toBe(expected);
  });

  it.each([
    [4.999, 'USD'],
    [0.99, 'JPY'],
    [1e-7, 'USD'],
    [1e21, 'USD'],
    [Number.NaN, 'USD'],
    [Number.POSITIVE_INFINITY, 'USD'],
  ])('returns null for %s %s instead of rounding', (price, currency) => {
    expect(revenueCatPriceToMinor(price, currency)).toBeNull();
  });
});
