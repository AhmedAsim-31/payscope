import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import {
  ENTITLEMENT_STATES,
  PAYMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
} from '@payscope/shared/records-schemas';
import { EVENT_STATUSES } from '@payscope/shared/events-schemas';
import { FINDING_SEVERITIES } from '@payscope/shared/reconciliation-schemas';
import { INCIDENT_STATUSES } from '@payscope/shared/incident-schemas';
import {
  OVERVIEW_RANGE_DAYS,
  type CurrencyOverview,
  type Overview,
  type OverviewRange,
} from '@payscope/shared/overview-schemas';
import type { Db } from '../db/client';
import { providerEventsTable } from '../db/schema/events';
import { incidentsTable } from '../db/schema/operations';
import { reconciliationFindingsTable } from '../db/schema/reconciliation';
import {
  entitlementRecordsTable,
  paymentRecordsTable as p,
  subscriptionRecordsTable,
} from '../db/schema/records';
import { listEvents, summarizeJobs } from '../events/event-inbox-repo';

const RECENT_EVENT_LIMIT = 10;

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

async function countsBy<K extends string>(
  keys: readonly K[],
  rows: Promise<{ key: K; total: number }[]>,
) {
  const counts = zeroed(keys);
  for (const row of await rows) counts[row.key] = row.total;
  return counts;
}

async function paymentsByCurrency(db: Db, orgId: string, since: Date): Promise<CurrencyOverview[]> {
  const rows = await db
    .select({
      currency: p.currency,
      status: p.status,
      total: count(),
      amount: sql<string>`coalesce(sum(${p.amountMinor}), 0)::text`,
      refunded: sql<string>`coalesce(sum(${p.amountRefundedMinor}), 0)::text`,
    })
    .from(p)
    .where(and(eq(p.orgId, orgId), gte(p.createdAt, since)))
    .groupBy(p.currency, p.status)
    .orderBy(p.currency);

  const byCurrency = new Map<string, CurrencyOverview & { refunded: bigint }>();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      total: 0,
      byStatus: zeroed(PAYMENT_STATUSES),
      succeededAmountMinor: '0',
      refundedAmountMinor: '0',
      refunded: 0n,
    };
    entry.total += row.total;
    entry.byStatus[row.status] = row.total;
    if (row.status === 'succeeded') entry.succeededAmountMinor = row.amount;
    entry.refunded += BigInt(row.refunded);
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.values()].map(({ refunded, ...entry }) => ({
    ...entry,
    refundedAmountMinor: refunded.toString(),
  }));
}

export async function loadOverview(db: Db, orgId: string, range: OverviewRange): Promise<Overview> {
  const since = new Date(Date.now() - OVERVIEW_RANGE_DAYS[range] * 86_400_000);
  const e = providerEventsTable;
  const s = subscriptionRecordsTable;
  const n = entitlementRecordsTable;
  const f = reconciliationFindingsTable;
  const i = incidentsTable;

  const [payments, subscriptions, entitlements, events, severities, incidents, jobs, recent] =
    await Promise.all([
      paymentsByCurrency(db, orgId, since),
      countsBy(
        SUBSCRIPTION_STATUSES,
        db
          .select({ key: s.status, total: count() })
          .from(s)
          .where(eq(s.orgId, orgId))
          .groupBy(s.status),
      ),
      countsBy(
        ENTITLEMENT_STATES,
        db
          .select({ key: n.state, total: count() })
          .from(n)
          .where(eq(n.orgId, orgId))
          .groupBy(n.state),
      ),
      countsBy(
        EVENT_STATUSES,
        db
          .select({ key: e.status, total: count() })
          .from(e)
          .where(and(eq(e.orgId, orgId), gte(e.receivedAt, since)))
          .groupBy(e.status),
      ),
      countsBy(
        FINDING_SEVERITIES,
        db
          .select({ key: f.severity, total: count() })
          .from(f)
          .where(and(eq(f.orgId, orgId), eq(f.status, 'open')))
          .groupBy(f.severity),
      ),
      countsBy(
        INCIDENT_STATUSES,
        db
          .select({ key: i.status, total: count() })
          .from(i)
          .where(and(eq(i.orgId, orgId), ne(i.status, 'resolved')))
          .groupBy(i.status),
      ),
      summarizeJobs(db, orgId),
      listEvents(db, orgId, { limit: RECENT_EVENT_LIMIT }),
    ]);

  const attempted = events.processed + events.failed + events.needs_attention;
  return {
    range,
    since: since.toISOString(),
    payments,
    subscriptions,
    entitlements,
    events,
    processing: {
      processed: events.processed,
      attempted,
      successRate: attempted === 0 ? null : events.processed / attempted,
    },
    jobs: {
      queued: jobs.counts.queued,
      running: jobs.counts.running,
      dead: jobs.counts.dead,
      oldestQueuedAgeSeconds: jobs.oldestQueuedAgeSeconds,
    },
    findings: {
      open: Object.values(severities).reduce((sum, v) => sum + v, 0),
      bySeverity: severities,
    },
    incidents: { open: incidents.open, investigating: incidents.investigating },
    recentEvents: recent.items,
  };
}
