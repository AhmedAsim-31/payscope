import { and, desc, eq, exists, ilike, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { customerQuerySchema } from '@payscope/shared/records-schemas';
import type { Db } from '../db/client';
import {
  customersTable as c,
  providerConnectionsTable,
  providerCustomerMappingsTable as m,
} from '../db/schema/providers';
import { entitlementRecordsTable as e, subscriptionRecordsTable as s } from '../db/schema/records';
import { selectEntitlements, toEntitlement } from './entitlements-repo';
import { cursorTsColumn, iso, keysetAfter, toPage } from './keyset';
import { selectSubscriptions, toSubscription } from './subscriptions-repo';
import { escapeLike } from './escape-like';

const DETAIL_CHILD_LIMIT = 50;

type CustomerQuery = z.output<typeof customerQuerySchema>;

const columns = {
  id: c.id,
  email: c.email,
  displayName: c.displayName,
  externalRef: c.externalRef,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  cursorTs: cursorTsColumn(c.createdAt),
};

type CustomerRow = {
  id: string;
  email: string | null;
  displayName: string | null;
  externalRef: string | null;
  createdAt: Date;
};

function toCustomer(row: CustomerRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    externalRef: row.externalRef,
    createdAt: iso(row.createdAt),
  };
}

export async function listCustomers(db: Db, orgId: string, q: CustomerQuery) {
  const where = and(
    eq(c.orgId, orgId),
    q.q === undefined
      ? undefined
      : or(
          ilike(c.email, `${escapeLike(q.q)}%`),
          exists(
            db
              .select({ one: m.id })
              .from(m)
              .where(
                and(eq(m.orgId, orgId), eq(m.providerCustomerId, q.q), eq(m.customerId, c.id)),
              ),
          ),
        ),
    keysetAfter(c.createdAt, c.id, q.cursor),
  );
  const rows = await db
    .select(columns)
    .from(c)
    .where(where)
    .orderBy(desc(c.createdAt), desc(c.id))
    .limit(q.limit + 1);
  return toPage(rows, q.limit, toCustomer);
}

export async function getCustomer(db: Db, orgId: string, customerId: string) {
  const [row] = await db
    .select(columns)
    .from(c)
    .where(and(eq(c.orgId, orgId), eq(c.id, customerId)))
    .limit(1);
  if (!row) return undefined;
  const [mappings, subscriptions, entitlements] = await Promise.all([
    db
      .select({
        provider: providerConnectionsTable.provider,
        connectionId: m.connectionId,
        providerCustomerId: m.providerCustomerId,
      })
      .from(m)
      .innerJoin(
        providerConnectionsTable,
        and(
          eq(providerConnectionsTable.orgId, m.orgId),
          eq(providerConnectionsTable.id, m.connectionId),
        ),
      )
      .where(and(eq(m.orgId, orgId), eq(m.customerId, customerId)))
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(DETAIL_CHILD_LIMIT),
    selectSubscriptions(
      db,
      and(eq(s.orgId, orgId), eq(s.customerId, customerId)),
      DETAIL_CHILD_LIMIT,
    ),
    selectEntitlements(
      db,
      and(eq(e.orgId, orgId), eq(e.customerId, customerId)),
      DETAIL_CHILD_LIMIT,
    ),
  ]);
  return {
    ...toCustomer(row),
    updatedAt: iso(row.updatedAt),
    mappings,
    subscriptions: subscriptions.map(toSubscription),
    entitlements: entitlements.map(toEntitlement),
  };
}
