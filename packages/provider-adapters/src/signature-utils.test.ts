import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, timingSafeEqualHex, withinTolerance } from './signature-utils';

describe('hmacSha256Hex', () => {
  it('matches the openssl vector', () => {
    expect(hmacSha256Hex('secret', 'payload')).toBe(
      'b82fcb791acec57859b989b430a826488ce2e479fdf92326bd0a2e8375a42ba4',
    );
  });

  it('accepts a Buffer payload', () => {
    expect(hmacSha256Hex('secret', Buffer.from('payload'))).toBe(
      hmacSha256Hex('secret', 'payload'),
    );
  });
});

describe('timingSafeEqualHex', () => {
  it('is true for equal hex', () => {
    expect(timingSafeEqualHex('abcd01', 'abcd01')).toBe(true);
  });

  it('is false for unequal hex of the same length', () => {
    expect(timingSafeEqualHex('abcd01', 'abcd02')).toBe(false);
  });

  it('is false, not a throw, for different lengths', () => {
    expect(timingSafeEqualHex('abcd', 'abcd01')).toBe(false);
  });

  it('is false for non-hex input', () => {
    expect(timingSafeEqualHex('zzzz', 'zzzz')).toBe(false);
    expect(timingSafeEqualHex('abc', 'abc')).toBe(false);
  });
});

describe('withinTolerance', () => {
  const now = new Date(1_700_000_000_000);

  it('accepts the exact boundary in both directions', () => {
    expect(withinTolerance(1_700_000_000 - 300, now, 300)).toBe(true);
    expect(withinTolerance(1_700_000_000 + 300, now, 300)).toBe(true);
  });

  it('rejects one second past the boundary', () => {
    expect(withinTolerance(1_700_000_000 - 301, now, 300)).toBe(false);
    expect(withinTolerance(1_700_000_000 + 301, now, 300)).toBe(false);
  });

  it('rejects non-finite timestamps', () => {
    expect(withinTolerance(Number.NaN, now, 300)).toBe(false);
  });
});
