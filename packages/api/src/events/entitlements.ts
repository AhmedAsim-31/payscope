import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  entitlementRecordsTable as t,
  subscriptionRecordsTable as sub,
} from '../db/schema/records';
import type { ApplyContext, Tx } from './apply-types';
import { resolveCustomerId } from './customers';
import { periodEndOf } from './period-end';

type EntitlementState = typeof t.$inferInsert.state;

function stateOf(type: string): EntitlementState | undefined {
  if (type === 'subscription.created' || type === 'subscription.renewed') return 'active';
  if (type === 'subscription.expired') return 'expired';
  if (type === 'payment.refunded') return 'revoked';
  return undefined;
}

type UpsertInput = {
  tx: Tx;
  orgId: string;
  customerId: string;
  subscriptionId: string | null;
  keys: string[];
  state: EntitlementState;
  expiresAt: Date | null;
  occurredAt: Date;
};

/** One guarded statement: an older event never overwrites a newer entitlement row. */
export async function upsertEntitlements(input: UpsertInput): Promise<boolean> {
  const { tx, orgId, customerId, subscriptionId, keys, state, expiresAt, occurredAt } = input;
  const active = state === 'active';
  const rows = await tx
    .insert(t)
    .values(
      keys.map((entitlementKey) => ({
        orgId,
        customerId,
        subscriptionId,
        entitlementKey,
        state,
        source: 'provider_event' as const,
        grantedAt: active ? occurredAt : null,
        expiresAt,
        revokedAt: state === 'revoked' ? occurredAt : null,
        lastEventAt: occurredAt,
      })),
    )
    .onConflictDoUpdate({
      target: [t.orgId, t.customerId, t.entitlementKey],
      set: {
        state,
        source: 'provider_event',
        ...(active
          ? {
              grantedAt: sql`CASE WHEN ${t.state} = 'active' THEN ${t.grantedAt} ELSE excluded.granted_at END`,
              revokedAt: null,
            }
          : {}),
        ...(state === 'revoked' ? { revokedAt: occurredAt } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        subscriptionId: sql`COALESCE(excluded.subscription_id, ${t.subscriptionId})`,
        lastEventAt: occurredAt,
        version: sql`${t.version} + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${t.lastEventAt} IS NULL OR ${t.lastEventAt} <= excluded.last_event_at`,
    })
    .returning({ id: t.id });
  return rows.length > 0;
}

type RevokeInput = {
  tx: Tx;
  orgId: string;
  connectionId: string;
  providerSubscriptionId: string;
  occurredAt: Date;
};

/** Resolves the provider ref at revocation time, so a payment that arrived before its subscription still links. */
export async function revokeSubscriptionEntitlements(input: RevokeInput): Promise<void> {
  const { tx, orgId, connectionId, providerSubscriptionId, occurredAt } = input;
  const subscriptions = tx
    .select({ id: sub.id })
    .from(sub)
    .where(
      and(
        eq(sub.orgId, orgId),
        eq(sub.connectionId, connectionId),
        eq(sub.providerSubscriptionId, providerSubscriptionId),
      ),
    );
  await tx
    .update(t)
    .set({
      state: 'revoked',
      source: 'provider_event',
      revokedAt: occurredAt,
      lastEventAt: occurredAt,
      version: sql`${t.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(t.orgId, orgId),
        eq(t.state, 'active'),
        inArray(t.subscriptionId, subscriptions),
        or(isNull(t.lastEventAt), lte(t.lastEventAt, occurredAt)),
      ),
    );
}

/** Cancellation is deliberately absent from stateOf: access lasts until the period ends. */
export async function applyEntitlements(
  ctx: ApplyContext,
  subscriptionId: string | null,
): Promise<boolean> {
  const { tx, orgId, connectionId, event } = ctx;
  const state = stateOf(event.normalizedType);
  if (!state || event.entitlementKeys.length === 0 || !event.providerCustomerId) return false;
  const customerId = await resolveCustomerId(tx, orgId, connectionId, event.providerCustomerId);
  return upsertEntitlements({
    tx,
    orgId,
    customerId,
    subscriptionId,
    keys: event.entitlementKeys,
    state,
    expiresAt: periodEndOf(event.metadata),
    occurredAt: event.occurredAt,
  });
}
