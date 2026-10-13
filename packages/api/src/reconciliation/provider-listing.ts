import { and, eq, inArray } from 'drizzle-orm';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { ListWindow, ProviderObjectPage } from '@payscope/provider-adapters/provider-object';
import type { Db } from '../db/client';
import { paymentRecordsTable as pay } from '../db/schema/records';
import type { FindingDraft } from './finding-upsert';
import type { ProviderTarget } from './provider-checks';
import type { BatchDelta } from './run-store';

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
// Payments newer than this may still have their webhook in flight.
const GRACE_MS = 5 * 60 * 1000;

export function listWindowFor(startedAt: Date): ListWindow {
  return {
    from: new Date(startedAt.getTime() - LOOKBACK_MS),
    to: new Date(startedAt.getTime() - GRACE_MS),
  };
}

export type Listed =
  | { kind: 'ok'; page: ProviderObjectPage }
  | { kind: 'unavailable' }
  | { kind: 'auth' }
  | { kind: 'failed' };

export async function listPage(
  target: ProviderTarget,
  window: ListWindow,
  cursor: string | null,
): Promise<Listed> {
  const { adapter, ctx } = target;
  try {
    const page = await adapter.listPayments?.(ctx, window, cursor);
    return page ? { kind: 'ok', page } : { kind: 'failed' };
  } catch (err) {
    if (!(err instanceof ProviderError)) return { kind: 'failed' };
    if (err.category === 'unavailable' || err.category === 'transient') {
      return { kind: 'unavailable' };
    }
    return err.category === 'provider_auth' ? { kind: 'auth' } : { kind: 'failed' };
  }
}

export async function findMissingLocally(
  db: Db,
  run: { orgId: string; connectionId: string },
  window: ListWindow,
  page: ProviderObjectPage,
): Promise<{ drafts: FindingDraft[]; delta: BatchDelta }> {
  const ids = page.items.map((i) => i.objectId);
  const known =
    ids.length === 0
      ? []
      : await db
          .select({ providerPaymentId: pay.providerPaymentId })
          .from(pay)
          .where(
            and(
              eq(pay.orgId, run.orgId),
              eq(pay.connectionId, run.connectionId),
              inArray(pay.providerPaymentId, ids),
            ),
          );
  const local = new Set(known.map((k) => k.providerPaymentId));
  const drafts: FindingDraft[] = page.items
    .filter((i) => !local.has(i.objectId))
    .map((i) => ({
      type: 'provider_payment_missing_locally',
      severity: 'high',
      subjectType: 'connection',
      subjectId: run.connectionId,
      key: i.objectId,
      recommendedAction:
        'Reprocess or replay the provider webhook for this payment so a local record exists.',
      evidence: {
        providerPaymentId: i.objectId,
        provider: {
          status: i.status,
          amountMinor: i.amountMinor?.toString() ?? null,
          currency: i.currency,
        },
        window: { from: window.from.toISOString(), to: window.to.toISOString() },
      },
    }));
  return {
    drafts,
    delta: {
      examined: ids.length,
      matched: ids.length - drafts.length,
      mismatched: drafts.length,
      unavailable: 0,
      failed: 0,
    },
  };
}
