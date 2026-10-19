import { formatMinor } from '@payscope/shared/money';
import type { Money } from '@payscope/shared/records-schemas';
import { PROVIDER_LABELS } from '@/lib/connection-queries';

const timestampFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
});

export function formatMoney(money: Money): string {
  return `${formatMinor(BigInt(money.amountMinor), money.currency, true)} ${money.currency}`;
}

export function formatTimestamp(iso: string): string {
  return `${timestampFormat.format(new Date(iso))} UTC`;
}

export function recordHref(orgId: string, resource: string, id: string): string {
  return `/app/${orgId}/${resource}/${id}`;
}

export function humanize(value: string): string {
  if (Object.hasOwn(PROVIDER_LABELS, value))
    return PROVIDER_LABELS[value as keyof typeof PROVIDER_LABELS];
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
