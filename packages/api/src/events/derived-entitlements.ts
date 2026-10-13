import { and, eq } from 'drizzle-orm';
import { entitlementMapSchema } from '../connections/entitlement-map';
import { providerConnectionsTable } from '../db/schema/providers';
import { subscriptionRecordsTable as sub } from '../db/schema/records';
import type { ApplyContext, ApplyOutcome } from './apply-types';
import { upsertEntitlements } from './entitlements';

type EntitlementState = 'active' | 'expired';

function stateOf(status: string, periodEnd: Date | null, now: Date): EntitlementState | undefined {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'expired') return 'expired';
  if (status === 'canceled') return periodEnd && periodEnd > now ? 'active' : 'expired';
  return undefined;
}

/** Derives entitlements from the subscription row just written, using the connection's plan map. */
export async function deriveEntitlements(
  ctx: ApplyContext,
  subscriptionId: string,
): Promise<ApplyOutcome> {
  const { tx, orgId, connectionId, event } = ctx;
  const [row] = await tx
    .select({
      customerId: sub.customerId,
      planRef: sub.planRef,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      entitlementMap: providerConnectionsTable.entitlementMap,
    })
    .from(sub)
    .innerJoin(providerConnectionsTable, eq(providerConnectionsTable.id, sub.connectionId))
    .where(
      and(eq(sub.id, subscriptionId), eq(sub.orgId, orgId), eq(sub.connectionId, connectionId)),
    );
  if (!row) return { kind: 'applied' };
  const keys = row.planRef
    ? entitlementMapSchema.catch({}).parse(row.entitlementMap)[row.planRef]
    : undefined;
  if (!keys || keys.length === 0) return { kind: 'noted', note: 'plan_unmapped' };
  const state = stateOf(row.status, row.currentPeriodEnd, event.occurredAt);
  if (!state) return { kind: 'applied' };
  await upsertEntitlements({
    tx,
    orgId,
    customerId: row.customerId,
    subscriptionId,
    keys,
    state,
    expiresAt: row.currentPeriodEnd,
    occurredAt: event.occurredAt,
  });
  return { kind: 'applied' };
}
