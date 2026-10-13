import { describe, expect, it } from 'vitest';
import { pageQuerySchema } from './records-schemas';

describe('pageQuerySchema', () => {
  it('defaults to 25 and caps at 100', () => {
    expect(pageQuerySchema.parse({}).limit).toBe(25);
    expect(pageQuerySchema.parse({ limit: '5000' }).limit).toBe(100);
  });

  it('rejects a non-positive limit', () => {
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});
