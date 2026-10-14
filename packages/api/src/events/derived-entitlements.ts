import { and, eq } from 'drizzle-orm';
import { entitlementMapSchema } from '../connections/entitlement-map';
import { providerConnectionsTable } from '../db/schema/providers';
import { subscriptionRecordsTable as sub } from '../db/schema/records';
import type { ApplyContext, ApplyOutcome, Tx } from './apply-types';
import { upsertEntitlements } from './entitlements';

type EntitlementState = 'active' | 'expired';
export type DerivedEntitlements = { state: EntitlementState; keys: string[]; changed: boolean };

function stateOf(status: string, periodEnd: Date | null, now: Date): EntitlementState | undefined {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'expired') return 'expired';
  if (status === 'canceled') return periodEnd && periodEnd > now ? 'active' : 'expired';
  return undefined;
}

/** Derives entitlements from the subscription row as it now stands, using the connection's plan map. */
export async function deriveFromSubscription(
  tx: Tx,
  orgId: string,
  subscriptionId: string,
  at: Date,
): Promise<DerivedEntitlements | 'plan_unmapped' | undefined> {
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
    .where(and(eq(sub.id, subscriptionId), eq(sub.orgId, orgId)));
  if (!row) return undefined;
  const keys = row.planRef
    ? entitlementMapSchema.catch({}).parse(row.entitlementMap)[row.planRef]
    : undefined;
  if (!keys || keys.length === 0) return 'plan_unmapped';
  const state = stateOf(row.status, row.currentPeriodEnd, at);
  if (!state) return undefined;
  const changed = await upsertEntitlements({
    tx,
    orgId,
    customerId: row.customerId,
    subscriptionId,
    keys,
    state,
    expiresAt: row.currentPeriodEnd,
    occurredAt: at,
  });
  return { state, keys, changed };
}

export async function deriveEntitlements(
  ctx: ApplyContext,
  subscriptionId: string,
): Promise<ApplyOutcome> {
  const derived = await deriveFromSubscription(
    ctx.tx,
    ctx.orgId,
    subscriptionId,
    ctx.event.occurredAt,
  );
  return derived === 'plan_unmapped'
    ? { kind: 'noted', note: 'plan_unmapped' }
    : { kind: 'applied' };
}
