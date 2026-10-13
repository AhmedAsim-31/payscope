import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { sql, type SQL } from 'drizzle-orm';
import { paymentRecordsTable as t } from '../db/schema/records';
import type { ApplyContext, ApplyOutcome } from './apply-types';
import { resolveCustomerId } from './customers';

type PaymentStatus = typeof t.$inferInsert.status;

const CUMULATIVE_REFUND_PROVIDERS = new Set(['stripe']);

function plainStatus(type: string): PaymentStatus | undefined {
  if (type === 'payment.succeeded') return 'succeeded';
  if (type === 'payment.failed') return 'failed';
  if (type === 'payment.disputed') return 'disputed';
  return undefined;
}

function refundedAfter(cumulative: boolean): SQL {
  const next = cumulative
    ? sql`excluded.amount_refunded_minor`
    : sql`${t.amountRefundedMinor} + excluded.amount_refunded_minor`;
  return sql`LEAST(${next}, ${t.amountMinor})`;
}

export async function applyPayment(ctx: ApplyContext): Promise<ApplyOutcome> {
  const { tx, orgId, connectionId, event } = ctx;
  if (!event.currency) throw new ProviderError('invalid_input', 'payment event has no currency');
  const customerId = event.providerCustomerId
    ? await resolveCustomerId(tx, orgId, connectionId, event.providerCustomerId)
    : null;
  const amount = event.amountMinor ?? 0n;
  const refund = event.normalizedType === 'payment.refunded';
  const status = plainStatus(event.normalizedType);
  if (!refund && !status) return { kind: 'noted', note: 'payment_type_not_applicable' };
  const refunded = refundedAfter(CUMULATIVE_REFUND_PROVIDERS.has(event.provider));

  const rows = await tx
    .insert(t)
    .values({
      orgId,
      connectionId,
      customerId,
      providerPaymentId: event.objectId,
      status: refund ? 'refunded' : (status ?? 'pending'),
      amountMinor: amount,
      amountRefundedMinor: refund ? amount : 0n,
      currency: event.currency,
      lastEventAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: [t.connectionId, t.providerPaymentId],
      set: {
        status: refund
          ? sql`(CASE WHEN ${refunded} >= ${t.amountMinor} THEN 'refunded' ELSE 'partially_refunded' END)::payment_status`
          : (status ?? 'pending'),
        ...(refund ? { amountRefundedMinor: refunded } : {}),
        customerId: sql`COALESCE(${t.customerId}, excluded.customer_id)`,
        lastEventAt: event.occurredAt,
        version: sql`${t.version} + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${t.lastEventAt} IS NULL OR ${t.lastEventAt} <= excluded.last_event_at`,
    })
    .returning({ id: t.id });
  return rows.length > 0 ? { kind: 'applied' } : { kind: 'stale' };
}
