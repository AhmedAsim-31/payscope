import { and, desc, eq, exists, gte, lt, lte, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { paymentQuerySchema } from '@payscope/shared/records-schemas';
import type { Db } from '../db/client';
import { providerEventsTable } from '../db/schema/events';
import { customersTable, providerConnectionsTable } from '../db/schema/providers';
import { paymentRecordsTable as p, subscriptionRecordsTable as s } from '../db/schema/records';
import { cursorTsColumn, iso, isoOrNull, keysetAfter, toPage } from './keyset';

const RELATED_EVENT_LIMIT = 50;

type PaymentQuery = z.output<typeof paymentQuerySchema>;

const columns = {
  id: p.id,
  provider: providerConnectionsTable.provider,
  connectionId: p.connectionId,
  providerPaymentId: p.providerPaymentId,
  status: p.status,
  amountMinor: p.amountMinor,
  amountRefundedMinor: p.amountRefundedMinor,
  currency: p.currency,
  customerId: customersTable.id,
  customerEmail: customersTable.email,
  providerCreatedAt: p.providerCreatedAt,
  lastEventAt: p.lastEventAt,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  cursorTs: cursorTsColumn(p.createdAt),
};

function selectRows(db: Db, where: SQL | undefined, limit: number) {
  return db
    .select(columns)
    .from(p)
    .innerJoin(
      providerConnectionsTable,
      and(
        eq(providerConnectionsTable.orgId, p.orgId),
        eq(providerConnectionsTable.id, p.connectionId),
      ),
    )
    .leftJoin(
      customersTable,
      and(eq(customersTable.orgId, p.orgId), eq(customersTable.id, p.customerId)),
    )
    .where(where)
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(limit);
}

type PaymentRow = Awaited<ReturnType<typeof selectRows>>[number];

function toPayment(row: PaymentRow) {
  return {
    id: row.id,
    provider: row.provider,
    connectionId: row.connectionId,
    providerPaymentId: row.providerPaymentId,
    status: row.status,
    amount: { amountMinor: row.amountMinor.toString(), currency: row.currency },
    amountRefunded: { amountMinor: row.amountRefundedMinor.toString(), currency: row.currency },
    customer: row.customerId ? { id: row.customerId, email: row.customerEmail } : null,
    providerCreatedAt: isoOrNull(row.providerCreatedAt),
    createdAt: iso(row.createdAt),
  };
}

export async function listPayments(db: Db, orgId: string, q: PaymentQuery) {
  const where = and(
    eq(p.orgId, orgId),
    q.status === undefined ? undefined : eq(p.status, q.status),
    q.provider === undefined ? undefined : eq(providerConnectionsTable.provider, q.provider),
    q.currency === undefined ? undefined : eq(p.currency, q.currency),
    q.connectionId === undefined ? undefined : eq(p.connectionId, q.connectionId),
    q.from === undefined ? undefined : gte(p.createdAt, new Date(q.from)),
    q.to === undefined ? undefined : lt(p.createdAt, new Date(q.to)),
    q.minAmount === undefined ? undefined : gte(p.amountMinor, q.minAmount),
    q.maxAmount === undefined ? undefined : lte(p.amountMinor, q.maxAmount),
    q.customerId === undefined ? undefined : eq(p.customerId, q.customerId),
    q.subscriptionId === undefined
      ? undefined
      : exists(
          db
            .select({ id: s.id })
            .from(s)
            .where(
              and(
                eq(s.orgId, p.orgId),
                eq(s.id, q.subscriptionId),
                eq(s.connectionId, p.connectionId),
                eq(s.providerSubscriptionId, p.providerSubscriptionId),
              ),
            ),
        ),
    keysetAfter(p.createdAt, p.id, q.cursor),
  );
  const rows = await selectRows(db, where, q.limit + 1);
  return toPage(rows, q.limit, toPayment);
}

export async function getPayment(db: Db, orgId: string, paymentId: string) {
  const [row] = await selectRows(db, and(eq(p.orgId, orgId), eq(p.id, paymentId)), 1);
  if (!row) return undefined;
  const events = await db
    .select({
      id: providerEventsTable.id,
      eventType: providerEventsTable.eventType,
      normalizedType: providerEventsTable.normalizedType,
      status: providerEventsTable.status,
      occurredAt: providerEventsTable.occurredAt,
      receivedAt: providerEventsTable.receivedAt,
    })
    .from(providerEventsTable)
    .where(
      and(
        eq(providerEventsTable.orgId, orgId),
        eq(providerEventsTable.connectionId, row.connectionId),
        eq(providerEventsTable.objectRef, row.providerPaymentId),
      ),
    )
    .orderBy(desc(providerEventsTable.receivedAt), desc(providerEventsTable.id))
    .limit(RELATED_EVENT_LIMIT);
  return {
    ...toPayment(row),
    lastEventAt: isoOrNull(row.lastEventAt),
    updatedAt: iso(row.updatedAt),
    events: events.map((e) => ({
      ...e,
      occurredAt: iso(e.occurredAt),
      receivedAt: iso(e.receivedAt),
    })),
  };
}
