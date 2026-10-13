import { and, eq, inArray } from 'drizzle-orm';
import type { NormalizedEvent } from '@payscope/provider-adapters/normalized-event';
import { providerEventsTable } from '../db/schema/events';
import type { ApplyContext, ApplyOutcome, Tx } from './apply-types';
import { applyDispute } from './disputes';
import { deriveEntitlements } from './derived-entitlements';
import { applyEntitlements } from './entitlements';
import { applyPayment } from './payments';
import { applySubscription } from './subscriptions';

export type StoredEvent = { id: string; orgId: string; connectionId: string };

export type ApplyResult = ApplyOutcome | { kind: 'already_handled' } | { kind: 'unsupported' };

async function applyObject(ctx: ApplyContext): Promise<ApplyOutcome> {
  switch (ctx.event.objectType) {
    case 'payment': {
      const outcome = await applyPayment(ctx);
      if (outcome.kind === 'applied') await applyEntitlements(ctx, null);
      return outcome;
    }
    case 'subscription': {
      const subscriptionId = await applySubscription(ctx);
      if (!subscriptionId) return { kind: 'stale' };
      if (ctx.event.provider === 'revenuecat') {
        await applyEntitlements(ctx, subscriptionId);
        return { kind: 'applied' };
      }
      return deriveEntitlements(ctx, subscriptionId);
    }
    case 'dispute':
      return applyDispute(ctx);
    default:
      return { kind: 'noted', note: 'object_type_not_applicable' };
  }
}

/** The claim UPDATE doubles as the idempotency guard: a concurrent duplicate blocks on the row and then matches nothing. */
export async function applyEvent(
  tx: Tx,
  stored: StoredEvent,
  event: NormalizedEvent,
): Promise<ApplyResult> {
  const unsupported = event.normalizedType === 'unsupported';
  const eventWhere = eq(providerEventsTable.id, stored.id);
  const [claimed] = await tx
    .update(providerEventsTable)
    .set({
      status: unsupported ? 'ignored' : 'processed',
      normalizedType: event.normalizedType,
      processedAt: new Date(),
    })
    .where(
      and(
        eventWhere,
        eq(providerEventsTable.orgId, stored.orgId),
        inArray(providerEventsTable.status, ['pending', 'processing', 'failed']),
      ),
    )
    .returning({ id: providerEventsTable.id });
  if (!claimed) return { kind: 'already_handled' };
  if (unsupported) return { kind: 'unsupported' };
  const outcome = await applyObject({
    tx,
    orgId: stored.orgId,
    connectionId: stored.connectionId,
    event,
  });
  if (outcome.kind === 'stale') {
    await tx.update(providerEventsTable).set({ status: 'ignored' }).where(eventWhere);
  }
  return outcome;
}
