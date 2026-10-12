import { describe, expect, it } from 'vitest';
import { formatMinor, parseDecimalToMinor } from './money';

describe('parseDecimalToMinor', () => {
  it('parses 2-decimal currencies', () => {
    expect(parseDecimalToMinor('10.00', 'USD')).toBe(1000n);
    expect(parseDecimalToMinor('1234', 'EUR')).toBe(123400n);
  });

  it('parses 0-decimal currencies', () => {
    expect(parseDecimalToMinor('1500', 'JPY')).toBe(1500n);
  });

  it('parses 3-decimal currencies', () => {
    expect(parseDecimalToMinor('1.234', 'KWD')).toBe(1234n);
  });

  it('handles negatives', () => {
    expect(parseDecimalToMinor('-3.5', 'USD')).toBe(-350n);
  });

  it('pads a missing fraction', () => {
    expect(parseDecimalToMinor('10.5', 'USD')).toBe(1050n);
  });

  it('accepts lowercase currency', () => {
    expect(parseDecimalToMinor('1.25', 'usd')).toBe(125n);
  });

  it('throws on too many fractional digits', () => {
    expect(() => parseDecimalToMinor('10.001', 'USD')).toThrow();
    expect(() => parseDecimalToMinor('10.5', 'JPY')).toThrow();
  });

  it('throws on garbage', () => {
    for (const bad of ['', 'abc', '1.', '.5', '1e3', '--1', '1,00', ' 1']) {
      expect(() => parseDecimalToMinor(bad, 'USD')).toThrow();
    }
  });
});

describe('formatMinor', () => {
  it('formats per currency exponent', () => {
    expect(formatMinor(1050n, 'USD')).toBe('10.50');
    expect(formatMinor(1500n, 'JPY')).toBe('1500');
    expect(formatMinor(1234n, 'KWD')).toBe('1.234');
    expect(formatMinor(-5n, 'USD')).toBe('-0.05');
  });

  it('round-trips with parseDecimalToMinor', () => {
    for (const [v, c] of [
      ['10.50', 'USD'],
      ['-0.05', 'USD'],
      ['1500', 'JPY'],
      ['1.234', 'KWD'],
    ] as const) {
      expect(formatMinor(parseDecimalToMinor(v, c), c)).toBe(v);
    }
  });
});
