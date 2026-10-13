import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { paymentRecordsTable as t } from '../db/schema/records';
import type { ApplyContext, ApplyOutcome } from './apply-types';

const PAYMENT_REF_KEYS = ['paymentIntentId', 'transactionId', 'paymentId'] as const;

function paymentRefOf(metadata: ApplyContext['event']['metadata']): string | undefined {
  for (const key of PAYMENT_REF_KEYS) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

export async function applyDispute(ctx: ApplyContext): Promise<ApplyOutcome> {
  const { tx, connectionId, event } = ctx;
  if (event.normalizedType !== 'payment.disputed') return { kind: 'noted', note: 'dispute_closed' };
  const ref = paymentRefOf(event.metadata);
  if (!ref) return { kind: 'noted', note: 'dispute_payment_ref_missing' };
  const match = and(eq(t.connectionId, connectionId), eq(t.providerPaymentId, ref));
  const rows = await tx
    .update(t)
    .set({
      status: 'disputed',
      lastEventAt: event.occurredAt,
      version: sql`${t.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(match, or(isNull(t.lastEventAt), lte(t.lastEventAt, event.occurredAt))))
    .returning({ id: t.id });
  if (rows.length > 0) return { kind: 'applied' };
  const [known] = await tx.select({ id: t.id }).from(t).where(match);
  return known ? { kind: 'stale' } : { kind: 'noted', note: 'dispute_payment_unknown' };
}
