import { describe, expect, it } from 'vitest';
import { BACKOFF_CAP_MS, computeBackoffMs } from './backoff';

describe('computeBackoffMs', () => {
  it('doubles the ceiling per attempt starting at 5s', () => {
    const nearOne = () => 0.999999;
    expect(computeBackoffMs(1, nearOne)).toBe(4_999);
    expect(computeBackoffMs(2, nearOne)).toBe(9_999);
    expect(computeBackoffMs(3, nearOne)).toBe(19_999);
  });

  it('caps at 15 minutes however many attempts', () => {
    expect(computeBackoffMs(50, () => 0.999999)).toBe(BACKOFF_CAP_MS - 1);
    expect(computeBackoffMs(9, () => 0.999999)).toBe(BACKOFF_CAP_MS - 1);
  });

  it('applies full jitter down to zero', () => {
    expect(computeBackoffMs(4, () => 0)).toBe(0);
    expect(computeBackoffMs(1, () => 0.5)).toBe(2_500);
  });
});
