import { describe, expect, it } from 'vitest';
import { parsePaddleMinorUnits } from './paddle-amount';

describe('parsePaddleMinorUnits', () => {
  it('parses integer strings beyond Number precision', () => {
    expect(parsePaddleMinorUnits('2499')).toBe(2499n);
    expect(parsePaddleMinorUnits('-500')).toBe(-500n);
    expect(parsePaddleMinorUnits('0')).toBe(0n);
    expect(parsePaddleMinorUnits('9007199254740993')).toBe(9007199254740993n);
  });

  it.each(['10.5', '', '1e3', ' 10', '10 ', '+5', '--5', 'abc', '1,000'])('rejects %j', (value) => {
    expect(() => parsePaddleMinorUnits(value)).toThrow(/minor-unit/);
  });
});
