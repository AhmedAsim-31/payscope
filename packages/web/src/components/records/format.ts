import { formatMinor } from '@payscope/shared/money';
import type { Money } from '@payscope/shared/records-schemas';

const timestampFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
});

export function formatMoney(money: Money): string {
  return `${formatMinor(BigInt(money.amountMinor), money.currency)} ${money.currency}`;
}

export function formatTimestamp(iso: string): string {
  return `${timestampFormat.format(new Date(iso))} UTC`;
}

export function recordHref(orgId: string, resource: string, id: string): string {
  return `/app/${orgId}/${resource}/${id}`;
}

export function humanize(value: string): string {
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
