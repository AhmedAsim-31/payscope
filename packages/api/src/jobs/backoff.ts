export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CAP_MS = 15 * 60_000;

/** Exponential backoff with full jitter: uniform in [0, min(cap, base * 2^(attempt-1))). */
export function computeBackoffMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.min(Math.max(attempt, 1) - 1, 30);
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
  return Math.floor(random() * ceiling);
}
