import { sql } from 'drizzle-orm';
import { entitlementRecordsTable as t } from '../db/schema/records';
import type { ApplyContext } from './apply-types';
import { resolveCustomerId } from './customers';
import { periodEndOf } from './period-end';

type EntitlementState = typeof t.$inferInsert.state;

function stateOf(type: string): EntitlementState | undefined {
  if (type === 'subscription.created' || type === 'subscription.renewed') return 'active';
  if (type === 'subscription.expired') return 'expired';
  if (type === 'payment.refunded') return 'revoked';
  return undefined;
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
  const expiresAt = periodEndOf(event.metadata);
  const active = state === 'active';
  const rows = await tx
    .insert(t)
    .values(
      event.entitlementKeys.map((entitlementKey) => ({
        orgId,
        customerId,
        subscriptionId,
        entitlementKey,
        state,
        source: 'provider_event' as const,
        grantedAt: active ? event.occurredAt : null,
        expiresAt,
        revokedAt: state === 'revoked' ? event.occurredAt : null,
        lastEventAt: event.occurredAt,
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
        ...(state === 'revoked' ? { revokedAt: event.occurredAt } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        subscriptionId: sql`COALESCE(excluded.subscription_id, ${t.subscriptionId})`,
        lastEventAt: event.occurredAt,
        version: sql`${t.version} + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${t.lastEventAt} IS NULL OR ${t.lastEventAt} <= excluded.last_event_at`,
    })
    .returning({ id: t.id });
  return rows.length > 0;
}
