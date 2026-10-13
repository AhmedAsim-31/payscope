type Entry<T> = { expiresAt: number; value: Promise<T> };

/** TTL cache that shares one in-flight load per key, so a burst costs a single query set. */
export function createOverviewCache<T>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, Entry<T>>();

  return function get(key: string, load: () => Promise<T>): Promise<T> {
    const current = now();
    for (const [k, entry] of entries) if (entry.expiresAt <= current) entries.delete(k);
    const hit = entries.get(key);
    if (hit) return hit.value;
    const value = load().catch((error: unknown) => {
      entries.delete(key);
      throw error;
    });
    entries.set(key, { expiresAt: current + ttlMs, value });
    return value;
  };
}
