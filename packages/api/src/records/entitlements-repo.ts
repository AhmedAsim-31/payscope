import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { entitlementQuerySchema } from '@payscope/shared/records-schemas';
import type { Db } from '../db/client';
import { customersTable } from '../db/schema/providers';
import { entitlementRecordsTable as e } from '../db/schema/records';
import { cursorTsColumn, iso, isoOrNull, keysetAfter, toPage } from './keyset';

type EntitlementQuery = z.output<typeof entitlementQuerySchema>;

const columns = {
  id: e.id,
  entitlementKey: e.entitlementKey,
  state: e.state,
  source: e.source,
  customerId: customersTable.id,
  customerEmail: customersTable.email,
  subscriptionId: e.subscriptionId,
  grantedAt: e.grantedAt,
  expiresAt: e.expiresAt,
  revokedAt: e.revokedAt,
  reconciliationStatus: e.reconciliationStatus,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
  cursorTs: cursorTsColumn(e.createdAt),
};

export function selectEntitlements(db: Pick<Db, 'select'>, where: SQL | undefined, limit: number) {
  return db
    .select(columns)
    .from(e)
    .innerJoin(
      customersTable,
      and(eq(customersTable.orgId, e.orgId), eq(customersTable.id, e.customerId)),
    )
    .where(where)
    .orderBy(desc(e.createdAt), desc(e.id))
    .limit(limit);
}

type EntitlementRow = Awaited<ReturnType<typeof selectEntitlements>>[number];

export function toEntitlement(row: EntitlementRow) {
  return {
    id: row.id,
    entitlementKey: row.entitlementKey,
    state: row.state,
    source: row.source,
    customer: { id: row.customerId, email: row.customerEmail },
    subscriptionId: row.subscriptionId,
    grantedAt: isoOrNull(row.grantedAt),
    expiresAt: isoOrNull(row.expiresAt),
    revokedAt: isoOrNull(row.revokedAt),
    reconciliationStatus: row.reconciliationStatus,
    createdAt: iso(row.createdAt),
  };
}

export async function listEntitlements(db: Db, orgId: string, q: EntitlementQuery) {
  const where = and(
    eq(e.orgId, orgId),
    q.state === undefined ? undefined : eq(e.state, q.state),
    q.customerId === undefined ? undefined : eq(e.customerId, q.customerId),
    q.key === undefined ? undefined : eq(e.entitlementKey, q.key),
    keysetAfter(e.createdAt, e.id, q.cursor),
  );
  const rows = await selectEntitlements(db, where, q.limit + 1);
  return toPage(rows, q.limit, toEntitlement);
}

export async function getEntitlement(db: Pick<Db, 'select'>, orgId: string, entitlementId: string) {
  const [row] = await selectEntitlements(db, and(eq(e.orgId, orgId), eq(e.id, entitlementId)), 1);
  return row && { ...toEntitlement(row), updatedAt: iso(row.updatedAt) };
}
