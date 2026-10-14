import { EVENT_STATUSES } from '@payscope/shared/events-schemas';
import { INCIDENT_STATUSES } from '@payscope/shared/incident-schemas';
import {
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  FINDING_TYPES,
} from '@payscope/shared/reconciliation-schemas';
import {
  ENTITLEMENT_STATES,
  PAYMENT_STATUSES,
  RECORD_PROVIDERS,
  SUBSCRIPTION_STATUSES,
} from '@payscope/shared/records-schemas';

export type FilterField = {
  name: string;
  label: string;
  /** A scope is set by links from detail pages and is never rendered as an input. */
  kind: 'select' | 'text' | 'search' | 'date' | 'scope';
  options?: readonly string[];
  placeholder?: string;
  toParam?: (value: string) => string | undefined;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function startOfDay(value: string): string | undefined {
  return DATE_PATTERN.test(value) ? `${value}T00:00:00.000Z` : undefined;
}

function endExclusive(value: string): string | undefined {
  return DATE_PATTERN.test(value)
    ? new Date(Date.parse(`${value}T00:00:00.000Z`) + DAY_MS).toISOString()
    : undefined;
}

function currencyCode(value: string): string | undefined {
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : undefined;
}

function minorUnits(value: string): string | undefined {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

function scope(name: string): FilterField {
  return { name, label: name, kind: 'scope' };
}

export const PAYMENT_FILTERS: readonly FilterField[] = [
  { name: 'status', label: 'Status', kind: 'select', options: PAYMENT_STATUSES },
  { name: 'provider', label: 'Provider', kind: 'select', options: RECORD_PROVIDERS },
  { name: 'currency', label: 'Currency', kind: 'text', placeholder: 'USD', toParam: currencyCode },
  {
    name: 'minAmount',
    label: 'Min amount (minor units)',
    kind: 'text',
    placeholder: '1000',
    toParam: minorUnits,
  },
  {
    name: 'maxAmount',
    label: 'Max amount (minor units)',
    kind: 'text',
    placeholder: '50000',
    toParam: minorUnits,
  },
  { name: 'from', label: 'From', kind: 'date', toParam: startOfDay },
  { name: 'to', label: 'To', kind: 'date', toParam: endExclusive },
  scope('customerId'),
  scope('subscriptionId'),
];

export const SUBSCRIPTION_FILTERS: readonly FilterField[] = [
  { name: 'status', label: 'Status', kind: 'select', options: SUBSCRIPTION_STATUSES },
  { name: 'provider', label: 'Provider', kind: 'select', options: RECORD_PROVIDERS },
];

export const CUSTOMER_FILTERS: readonly FilterField[] = [
  { name: 'email', label: 'Email starts with', kind: 'text', placeholder: 'name@example.com' },
];

export const ENTITLEMENT_FILTERS: readonly FilterField[] = [
  { name: 'state', label: 'State', kind: 'select', options: ENTITLEMENT_STATES },
  { name: 'key', label: 'Key', kind: 'text', placeholder: 'pro_access' },
];

export const EVENT_FILTERS: readonly FilterField[] = [
  { name: 'status', label: 'Status', kind: 'select', options: EVENT_STATUSES },
  { name: 'provider', label: 'Provider', kind: 'select', options: RECORD_PROVIDERS },
  {
    name: 'normalizedType',
    label: 'Normalized type',
    kind: 'text',
    placeholder: 'payment.succeeded',
  },
  { name: 'from', label: 'From', kind: 'date', toParam: startOfDay },
  { name: 'to', label: 'To', kind: 'date', toParam: endExclusive },
  scope('connectionId'),
  scope('objectRef'),
  scope('customerId'),
];

export const FINDING_FILTERS: readonly FilterField[] = [
  { name: 'status', label: 'Status', kind: 'select', options: FINDING_STATUSES },
  { name: 'severity', label: 'Severity', kind: 'select', options: FINDING_SEVERITIES },
  { name: 'type', label: 'Type', kind: 'select', options: FINDING_TYPES },
  scope('subjectType'),
  scope('subjectId'),
  scope('runId'),
];

export const INCIDENT_FILTERS: readonly FilterField[] = [
  { name: 'status', label: 'Status', kind: 'select', options: INCIDENT_STATUSES },
  { name: 'severity', label: 'Severity', kind: 'select', options: FINDING_SEVERITIES },
  { name: 'category', label: 'Category', kind: 'select', options: FINDING_TYPES },
];

export const AUDIT_FILTERS: readonly FilterField[] = [
  { name: 'q', label: 'Search', kind: 'search', placeholder: 'Action, target, actor, reason' },
  { name: 'action', label: 'Action', kind: 'text', placeholder: 'repair.correct_entitlement' },
  { name: 'targetType', label: 'Target type', kind: 'text', placeholder: 'finding' },
  { name: 'targetId', label: 'Target id', kind: 'text', placeholder: 'uuid' },
  { name: 'from', label: 'From', kind: 'date', toParam: startOfDay },
  { name: 'to', label: 'To', kind: 'date', toParam: endExclusive },
  scope('customerId'),
];

export function toApiParams(
  fields: readonly FilterField[],
  read: (name: string) => string | null,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const field of fields) {
    const raw = read(field.name);
    if (!raw) continue;
    const value = field.toParam ? field.toParam(raw) : raw;
    if (value) params[field.name] = value;
  }
  return params;
}
