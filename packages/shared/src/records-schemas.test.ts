import { describe, expect, it } from 'vitest';
import { pageQuerySchema, paymentQuerySchema } from './records-schemas';

describe('pageQuerySchema', () => {
  it('defaults to 25 and caps at 100', () => {
    expect(pageQuerySchema.parse({}).limit).toBe(25);
    expect(pageQuerySchema.parse({ limit: '5000' }).limit).toBe(100);
  });

  it('rejects a non-positive limit', () => {
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('paymentQuerySchema amount range', () => {
  it('parses integer minor units to exact bigints', () => {
    const q = paymentQuerySchema.parse({ minAmount: '0', maxAmount: '9007199254740993123' });
    expect(q.minAmount).toBe(0n);
    expect(q.maxAmount).toBe(9007199254740993123n);
  });

  it.each(['1.5', '-1', '1e3', '', ' 1', '0x10', '9223372036854775808'])('rejects %j', (value) => {
    expect(paymentQuerySchema.safeParse({ minAmount: value }).success).toBe(false);
    expect(paymentQuerySchema.safeParse({ maxAmount: value }).success).toBe(false);
  });
});
