import { describe, expect, it, vi } from 'vitest';
import { createOverviewCache } from './overview-cache';

describe('createOverviewCache', () => {
  it('runs one load for concurrent callers of the same key', async () => {
    const get = createOverviewCache<number>(15_000);
    const load = vi.fn(() => Promise.resolve(1));
    const results = await Promise.all([get('k', load), get('k', load), get('k', load)]);
    expect(results).toEqual([1, 1, 1]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps keys separate and reloads after the ttl', async () => {
    let time = 0;
    const get = createOverviewCache<number>(100, () => time);
    const load = vi.fn(() => Promise.resolve(time));
    await get('a', load);
    await get('b', load);
    expect(load).toHaveBeenCalledTimes(2);
    time = 150;
    expect(await get('a', load)).toBe(150);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not cache failures', async () => {
    const get = createOverviewCache<number>(15_000);
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(2);
    await expect(get('k', load)).rejects.toThrow('boom');
    expect(await get('k', load)).toBe(2);
  });
});
