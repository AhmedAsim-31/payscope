import type { NormalizedEvent } from '@payscope/provider-adapters/normalized-event';

function toDate(value: unknown, scale: number): Date | null {
  if (typeof value === 'number') return new Date(value * scale);
  if (typeof value === 'string') return new Date(value);
  return null;
}

export function periodEndOf(metadata: NormalizedEvent['metadata']): Date | null {
  const candidates = [
    toDate(metadata?.['currentPeriodEnd'], 1000),
    toDate(metadata?.['nextBillingTime'], 1),
    toDate(metadata?.['expirationAtMs'], 1),
  ];
  return candidates.find((d) => d !== null && Number.isFinite(d.getTime())) ?? null;
}
