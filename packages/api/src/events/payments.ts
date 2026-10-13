import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { sql } from 'drizzle-orm';
import { paymentRecordsTable as t } from '../db/schema/records';
import type { ApplyContext, ApplyOutcome } from './apply-types';
import { resolveCustomerId } from './customers';

type PaymentStatus = typeof t.$inferInsert.status;

function plainStatus(type: string): PaymentStatus | undefined {
  if (type === 'payment.succeeded') return 'succeeded';
  if (type === 'payment.failed') return 'failed';
  if (type === 'payment.disputed') return 'disputed';
  return undefined;
}

export async function applyPayment(ctx: ApplyContext): Promise<ApplyOutcome> {
  const { tx, orgId, connectionId, event } = ctx;
  if (!event.currency) throw new ProviderError('invalid_input', 'payment event has no currency');
  const customerId = event.providerCustomerId
    ? await resolveCustomerId(tx, orgId, connectionId, event.providerCustomerId)
    : null;
  const status = plainStatus(event.normalizedType);
  if (!status) return { kind: 'noted', note: 'payment_type_not_applicable' };

  const rows = await tx
    .insert(t)
    .values({
      orgId,
      connectionId,
      customerId,
      providerPaymentId: event.objectId,
      status,
      amountMinor: event.amountMinor ?? 0n,
      currency: event.currency,
      lastEventAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: [t.connectionId, t.providerPaymentId],
      set: {
        status,
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
