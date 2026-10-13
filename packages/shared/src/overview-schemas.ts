import { z } from 'zod';
import { EVENT_STATUSES, eventSummarySchema } from './events-schemas';
import { FINDING_SEVERITIES } from './reconciliation-schemas';
import { ENTITLEMENT_STATES, PAYMENT_STATUSES, SUBSCRIPTION_STATUSES } from './records-schemas';

export const OVERVIEW_RANGES = ['7d', '30d', '90d'] as const;
export const DEFAULT_OVERVIEW_RANGE = '30d';
export const OVERVIEW_RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

export const overviewQuerySchema = z.object({
  range: z.enum(OVERVIEW_RANGES).default(DEFAULT_OVERVIEW_RANGE),
});
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

const count = z.number().int().nonnegative();
const countsBy = <T extends readonly [string, ...string[]]>(keys: T) =>
  z.record(z.enum(keys), count);

export const currencyOverviewSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  total: count,
  byStatus: countsBy(PAYMENT_STATUSES),
  succeededAmountMinor: z.string().regex(/^\d+$/),
  refundedAmountMinor: z.string().regex(/^\d+$/),
});
export type CurrencyOverview = z.infer<typeof currencyOverviewSchema>;

export const overviewSchema = z.object({
  range: z.enum(OVERVIEW_RANGES),
  since: z.iso.datetime(),
  payments: z.array(currencyOverviewSchema),
  subscriptions: countsBy(SUBSCRIPTION_STATUSES),
  entitlements: countsBy(ENTITLEMENT_STATES),
  events: countsBy(EVENT_STATUSES),
  processing: z.object({
    processed: count,
    attempted: count,
    successRate: z.number().min(0).max(1).nullable(),
  }),
  jobs: z.object({
    queued: count,
    running: count,
    dead: count,
    oldestQueuedAgeSeconds: count.nullable(),
  }),
  findings: z.object({ open: count, bySeverity: countsBy(FINDING_SEVERITIES) }),
  recentEvents: z.array(eventSummarySchema),
});
export type Overview = z.infer<typeof overviewSchema>;
