import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { subscriptionQuerySchema } from '@payscope/shared/records-schemas';
import type { Db } from '../db/client';
import { customersTable, providerConnectionsTable } from '../db/schema/providers';
import { entitlementRecordsTable as e, subscriptionRecordsTable as s } from '../db/schema/records';
import { selectEntitlements, toEntitlement } from './entitlements-repo';
import { cursorTsColumn, iso, isoOrNull, keysetAfter, toPage } from './keyset';

const DETAIL_CHILD_LIMIT = 50;

type SubscriptionQuery = z.output<typeof subscriptionQuerySchema>;

const columns = {
  id: s.id,
  provider: providerConnectionsTable.provider,
  connectionId: s.connectionId,
  providerSubscriptionId: s.providerSubscriptionId,
  status: s.status,
  planRef: s.planRef,
  currentPeriodStart: s.currentPeriodStart,
  currentPeriodEnd: s.currentPeriodEnd,
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  canceledAt: s.canceledAt,
  endedAt: s.endedAt,
  customerId: customersTable.id,
  customerEmail: customersTable.email,
  lastEventAt: s.lastEventAt,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  cursorTs: cursorTsColumn(s.createdAt),
};

export function selectSubscriptions(db: Db, where: SQL | undefined, limit: number) {
  return db
    .select(columns)
    .from(s)
    .innerJoin(
      providerConnectionsTable,
      and(
        eq(providerConnectionsTable.orgId, s.orgId),
        eq(providerConnectionsTable.id, s.connectionId),
      ),
    )
    .innerJoin(
      customersTable,
      and(eq(customersTable.orgId, s.orgId), eq(customersTable.id, s.customerId)),
    )
    .where(where)
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(limit);
}

type SubscriptionRow = Awaited<ReturnType<typeof selectSubscriptions>>[number];

export function toSubscription(row: SubscriptionRow) {
  return {
    id: row.id,
    provider: row.provider,
    connectionId: row.connectionId,
    providerSubscriptionId: row.providerSubscriptionId,
    status: row.status,
    planRef: row.planRef,
    currentPeriodStart: isoOrNull(row.currentPeriodStart),
    currentPeriodEnd: isoOrNull(row.currentPeriodEnd),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: isoOrNull(row.canceledAt),
    endedAt: isoOrNull(row.endedAt),
    customer: { id: row.customerId, email: row.customerEmail },
    createdAt: iso(row.createdAt),
  };
}

export async function listSubscriptions(db: Db, orgId: string, q: SubscriptionQuery) {
  const where = and(
    eq(s.orgId, orgId),
    q.status === undefined ? undefined : eq(s.status, q.status),
    q.provider === undefined ? undefined : eq(providerConnectionsTable.provider, q.provider),
    q.customerId === undefined ? undefined : eq(s.customerId, q.customerId),
    keysetAfter(s.createdAt, s.id, q.cursor),
  );
  const rows = await selectSubscriptions(db, where, q.limit + 1);
  return toPage(rows, q.limit, toSubscription);
}

export async function getSubscription(db: Db, orgId: string, subscriptionId: string) {
  const [row] = await selectSubscriptions(db, and(eq(s.orgId, orgId), eq(s.id, subscriptionId)), 1);
  if (!row) return undefined;
  const entitlements = await selectEntitlements(
    db,
    and(eq(e.orgId, orgId), eq(e.subscriptionId, subscriptionId)),
    DETAIL_CHILD_LIMIT,
  );
  return {
    ...toSubscription(row),
    lastEventAt: isoOrNull(row.lastEventAt),
    updatedAt: iso(row.updatedAt),
    entitlements: entitlements.map(toEntitlement),
  };
}
