import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { NormalizedEvent } from '@payscope/provider-adapters/normalized-event';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { subscriptionRecordsTable as t } from '../db/schema/records';
import type { ApplyContext } from './apply-types';
import { resolveCustomerId } from './customers';
import { periodEndOf } from './period-end';

type SubscriptionStatus = typeof t.$inferInsert.status;

const PROVIDER_STATUS: Readonly<Record<string, SubscriptionStatus>> = {
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  suspended: 'paused',
  canceled: 'canceled',
  cancelled: 'canceled',
  expired: 'expired',
};

function statusOf(event: NormalizedEvent): SubscriptionStatus {
  switch (event.normalizedType) {
    case 'subscription.canceled':
      return 'canceled';
    case 'subscription.expired':
      return 'expired';
    case 'subscription.renewed':
      return 'active';
    case 'payment.failed':
      return 'past_due';
    default:
      return PROVIDER_STATUS[event.status?.toLowerCase() ?? ''] ?? 'active';
  }
}

function cancelAtPeriodEndOf(event: NormalizedEvent): boolean {
  return (
    event.normalizedType === 'subscription.canceled' || !!event.metadata?.['cancelAtPeriodEnd']
  );
}

function planRefOf(event: NormalizedEvent): string | null {
  const plan = event.metadata?.['planId'] ?? event.metadata?.['product_id'];
  return typeof plan === 'string' ? plan : null;
}

/** Returns the subscription row id when the write applied, undefined when the event is stale. */
export async function applySubscription(ctx: ApplyContext): Promise<string | undefined> {
  const { tx, orgId, connectionId, event } = ctx;
  const periodEnd = periodEndOf(event.metadata);
  const planRef = planRefOf(event);
  const status = statusOf(event);
  const cancelAtPeriodEnd = cancelAtPeriodEndOf(event);
  const set = {
    status,
    cancelAtPeriodEnd,
    ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
    ...(planRef ? { planRef } : {}),
    lastEventAt: event.occurredAt,
    version: sql`${t.version} + 1`,
    updatedAt: sql`now()`,
  };
  const fresh = or(isNull(t.lastEventAt), lte(t.lastEventAt, event.occurredAt));

  if (!event.providerCustomerId) {
    const [row] = await tx
      .update(t)
      .set(set)
      .where(
        and(eq(t.connectionId, connectionId), eq(t.providerSubscriptionId, event.objectId), fresh),
      )
      .returning({ id: t.id });
    if (row) return row.id;
    const [known] = await tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.connectionId, connectionId), eq(t.providerSubscriptionId, event.objectId)));
    if (known) return undefined;
    throw new ProviderError('state_conflict', 'subscription event for an unknown subscription');
  }

  const customerId = await resolveCustomerId(tx, orgId, connectionId, event.providerCustomerId);
  const [row] = await tx
    .insert(t)
    .values({
      orgId,
      connectionId,
      customerId,
      providerSubscriptionId: event.objectId,
      status,
      planRef,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      lastEventAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: [t.connectionId, t.providerSubscriptionId],
      set,
      setWhere: sql`${t.lastEventAt} IS NULL OR ${t.lastEventAt} <= excluded.last_event_at`,
    })
    .returning({ id: t.id });
  return row?.id;
}
