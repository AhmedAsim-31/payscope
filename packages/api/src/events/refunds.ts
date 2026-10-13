import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { paymentRecordsTable as t } from '../db/schema/records';
import type { ApplyContext, ApplyOutcome } from './apply-types';
import { resolveCustomerId } from './customers';
import { applyEntitlements, revokeSubscriptionEntitlements } from './entitlements';
import { subscriptionRefOf } from './payments';

const CUMULATIVE_REFUND_PROVIDERS = new Set(['stripe']);

/** A one-off payment has no subscription, so its refund revokes nothing. */
async function revokeLinked(
  ctx: ApplyContext,
  providerSubscriptionId: string | null,
): Promise<void> {
  if (ctx.event.entitlementKeys.length > 0) {
    await applyEntitlements(ctx, null);
    return;
  }
  if (!providerSubscriptionId) return;
  await revokeSubscriptionEntitlements({
    tx: ctx.tx,
    orgId: ctx.orgId,
    connectionId: ctx.connectionId,
    providerSubscriptionId,
    occurredAt: ctx.event.occurredAt,
  });
}

/** A refund carries only the refunded amount, so it never creates the payment; it waits for it instead. */
export async function applyRefund(ctx: ApplyContext): Promise<ApplyOutcome> {
  const { tx, orgId, connectionId, event } = ctx;
  if (!event.currency) throw new ProviderError('invalid_input', 'payment event has no currency');
  const customerId = event.providerCustomerId
    ? await resolveCustomerId(tx, orgId, connectionId, event.providerCustomerId)
    : null;
  const amount = event.amountMinor ?? 0n;
  const next = CUMULATIVE_REFUND_PROVIDERS.has(event.provider)
    ? sql`${amount}::bigint`
    : sql`${t.amountRefundedMinor} + ${amount}::bigint`;
  const refunded = sql`LEAST(${next}, ${t.amountMinor})`;
  const match = and(
    eq(t.orgId, orgId),
    eq(t.connectionId, connectionId),
    eq(t.providerPaymentId, event.objectId),
  );

  const [row] = await tx
    .update(t)
    .set({
      status: sql`(CASE WHEN ${refunded} >= ${t.amountMinor} THEN 'refunded' ELSE 'partially_refunded' END)::payment_status`,
      amountRefundedMinor: refunded,
      customerId: sql`COALESCE(${t.customerId}, ${customerId}::uuid)`,
      providerSubscriptionId: sql`COALESCE(${t.providerSubscriptionId}, ${subscriptionRefOf(event.metadata)})`,
      lastEventAt: event.occurredAt,
      version: sql`${t.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(match, or(isNull(t.lastEventAt), lte(t.lastEventAt, event.occurredAt))))
    .returning({ status: t.status, providerSubscriptionId: t.providerSubscriptionId });
  if (row) {
    if (row.status === 'refunded') await revokeLinked(ctx, row.providerSubscriptionId);
    return { kind: 'applied' };
  }
  const [newer] = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(match, gt(t.lastEventAt, event.occurredAt)));
  if (newer) return { kind: 'stale' };
  if (event.entitlementKeys.length === 0) throw new Error('refund_payment_unknown');
  // A provider that names the entitlement keys asserts the revocation itself, with or without a local payment.
  await applyEntitlements(ctx, null);
  return { kind: 'noted', note: 'refund_payment_unknown' };
}
