import { and, eq, sql } from 'drizzle-orm';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { providerConnectionsTable as conn } from '../db/schema/providers';
import { paymentRecordsTable as pay, subscriptionRecordsTable as sub } from '../db/schema/records';
import { ApiHttpError } from '../http-error';
import {
  fetchOne,
  resolveProviderTarget,
  statusAgrees,
  type ObjectKind,
} from '../reconciliation/provider-checks';
import { outcome, type Outcome } from './repair-actions';
import { resolveRefreshedFindings, type RefreshActor } from './resolve-refreshed-findings';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PaymentStatus = typeof pay.$inferSelect.status;
type SubscriptionStatus = typeof sub.$inferSelect.status;
export type ProviderDeps = { adapters: AdapterRegistry; cipher: CredentialsCipher | undefined };

const PROVIDER_PAYMENT_STATUS: Readonly<Record<string, PaymentStatus>> = {
  succeeded: 'succeeded',
  completed: 'succeeded',
  paid: 'succeeded',
  failed: 'failed',
  declined: 'failed',
  canceled: 'canceled',
  refunded: 'refunded',
  partially_refunded: 'partially_refunded',
  pending: 'pending',
  processing: 'pending',
};

const PROVIDER_SUBSCRIPTION_STATUS: Readonly<Record<string, SubscriptionStatus>> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  paused: 'paused',
  suspended: 'paused',
  canceled: 'canceled',
  expired: 'expired',
  incomplete_expired: 'expired',
};

type Common = {
  targetId: string;
  version: number;
  matchesProvider: boolean;
  previousState: Record<string, unknown>;
  resultingState: Record<string, unknown>;
};
export type RefreshPlan =
  | (Common & {
      kind: 'payment';
      set: { status: PaymentStatus; amountMinor: bigint; currency: string };
    })
  | (Common & { kind: 'subscription'; set: { status: SubscriptionStatus } });

type ConnectionRow = {
  connectionId: string;
  provider: typeof conn.$inferSelect.provider;
  connectionStatus: typeof conn.$inferSelect.status;
  credentialsCiphertext: Buffer | null;
};

const connectionColumns = {
  connectionId: conn.id,
  provider: conn.provider,
  connectionStatus: conn.status,
  credentialsCiphertext: conn.credentialsCiphertext,
};

const view = (status: string, amountMinor: bigint, currency: string) => ({
  status,
  amountMinor: amountMinor.toString(),
  currency,
});

const normalize = (status: string) => status.toLowerCase().replace('cancelled', 'canceled');

function unmapped(status: string) {
  return new ApiHttpError(
    422,
    'PROVIDER_STATUS_UNMAPPED',
    `Provider status ${status} has no local equivalent`,
  );
}

async function fetchFromProvider(
  deps: ProviderDeps,
  row: ConnectionRow,
  kind: ObjectKind,
  providerObjectId: string,
) {
  if (row.connectionStatus !== 'active') {
    throw new ApiHttpError(
      409,
      'CONNECTION_NOT_VERIFIED',
      'The provider connection is not verified',
    );
  }
  const resolved = resolveProviderTarget(
    {
      id: row.connectionId,
      provider: row.provider,
      credentialsCiphertext: row.credentialsCiphertext,
    },
    deps.adapters,
    deps.cipher,
  );
  if (!resolved.ok) {
    throw new ApiHttpError(
      409,
      'PROVIDER_NOT_CONFIGURED',
      `The provider connection cannot fetch records (${resolved.reason})`,
    );
  }
  const { adapter } = resolved.target;
  if (kind === 'payment' ? !adapter.fetchPayment : !adapter.fetchSubscription) {
    throw new ApiHttpError(
      422,
      'PROVIDER_FETCH_UNSUPPORTED',
      `The ${row.provider} adapter cannot fetch a ${kind} from the provider`,
    );
  }
  const res = await fetchOne(resolved.target, kind, providerObjectId);
  if (res.kind === 'not_found') {
    throw new ApiHttpError(409, 'PROVIDER_OBJECT_NOT_FOUND', `The provider has no such ${kind}`);
  }
  if (res.kind === 'unavailable') {
    throw new ApiHttpError(502, 'PROVIDER_UNAVAILABLE', 'The provider is unreachable');
  }
  if (res.kind !== 'ok') {
    throw new ApiHttpError(502, 'PROVIDER_FETCH_FAILED', 'The provider request failed');
  }
  return res;
}

export async function planPaymentRefresh(
  db: Db,
  deps: ProviderDeps,
  orgId: string,
  paymentId: string,
): Promise<RefreshPlan> {
  const [row] = await db
    .select({
      status: pay.status,
      amountMinor: pay.amountMinor,
      amountRefundedMinor: pay.amountRefundedMinor,
      currency: pay.currency,
      version: pay.version,
      providerPaymentId: pay.providerPaymentId,
      ...connectionColumns,
    })
    .from(pay)
    .innerJoin(conn, and(eq(conn.orgId, pay.orgId), eq(conn.id, pay.connectionId)))
    .where(and(eq(pay.orgId, orgId), eq(pay.id, paymentId)));
  if (!row) throw new ApiHttpError(404, 'NOT_FOUND', 'Payment not found');
  const res = await fetchFromProvider(deps, row, 'payment', row.providerPaymentId);
  const status = statusAgrees(row.status, res.status)
    ? row.status
    : PROVIDER_PAYMENT_STATUS[normalize(res.status)];
  if (!status) throw unmapped(res.status);
  const amountMinor = res.amountMinor ?? row.amountMinor;
  const currency = res.currency ?? row.currency;
  if (status === row.status && amountMinor === row.amountMinor && currency === row.currency) {
    throw new ApiHttpError(409, 'ALREADY_CONSISTENT', 'The payment already matches the provider');
  }
  if (amountMinor < row.amountRefundedMinor) {
    throw new ApiHttpError(
      409,
      'REFUND_EXCEEDS_AMOUNT',
      'The provider amount is below the amount already refunded locally',
    );
  }
  return {
    kind: 'payment',
    targetId: paymentId,
    version: row.version,
    set: { status, amountMinor, currency },
    matchesProvider: statusAgrees(status, res.status),
    previousState: view(row.status, row.amountMinor, row.currency),
    resultingState: { ...view(status, amountMinor, currency), providerStatus: res.status },
  };
}

export async function planSubscriptionRefresh(
  db: Db,
  deps: ProviderDeps,
  orgId: string,
  subscriptionId: string,
): Promise<RefreshPlan> {
  const [row] = await db
    .select({
      status: sub.status,
      version: sub.version,
      providerSubscriptionId: sub.providerSubscriptionId,
      ...connectionColumns,
    })
    .from(sub)
    .innerJoin(conn, and(eq(conn.orgId, sub.orgId), eq(conn.id, sub.connectionId)))
    .where(and(eq(sub.orgId, orgId), eq(sub.id, subscriptionId)));
  if (!row) throw new ApiHttpError(404, 'NOT_FOUND', 'Subscription not found');
  const res = await fetchFromProvider(deps, row, 'subscription', row.providerSubscriptionId);
  const status = PROVIDER_SUBSCRIPTION_STATUS[normalize(res.status)];
  if (!status) throw unmapped(res.status);
  if (status === row.status) {
    throw new ApiHttpError(
      409,
      'ALREADY_CONSISTENT',
      'The subscription already matches the provider',
    );
  }
  return {
    kind: 'subscription',
    targetId: subscriptionId,
    version: row.version,
    set: { status },
    matchesProvider: statusAgrees(status, res.status),
    previousState: { status: row.status },
    resultingState: { status, providerStatus: res.status },
  };
}

async function writeRefresh(tx: Tx, orgId: string, plan: RefreshPlan) {
  // Webhooks that occurred before this read are already reflected and must not revert it.
  if (plan.kind === 'payment') {
    return tx
      .update(pay)
      .set({
        ...plan.set,
        lastEventAt: sql`greatest(${pay.lastEventAt}, now())`,
        version: sql`${pay.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(pay.orgId, orgId), eq(pay.id, plan.targetId), eq(pay.version, plan.version)))
      .returning({ id: pay.id });
  }
  return tx
    .update(sub)
    .set({
      ...plan.set,
      lastEventAt: sql`greatest(${sub.lastEventAt}, now())`,
      version: sql`${sub.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sub.orgId, orgId), eq(sub.id, plan.targetId), eq(sub.version, plan.version)))
    .returning({ id: sub.id });
}

export async function applyRefresh(
  tx: Tx,
  actor: RefreshActor,
  plan: RefreshPlan,
): Promise<Outcome> {
  const [row] = await writeRefresh(tx, actor.orgId, plan);
  if (!row) {
    throw new ApiHttpError(
      409,
      'CONCURRENT_UPDATE',
      `The ${plan.kind} changed while the provider was being read`,
    );
  }
  const resolvedFindingIds = plan.matchesProvider
    ? await resolveRefreshedFindings(tx, actor, plan.kind, plan.targetId)
    : [];
  return outcome('refresh_from_provider', plan.targetId, plan.previousState, {
    ...plan.resultingState,
    resolvedFindingIds,
  });
}
