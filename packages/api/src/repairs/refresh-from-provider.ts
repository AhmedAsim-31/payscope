import { and, eq, sql } from 'drizzle-orm';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { providerConnectionsTable as conn } from '../db/schema/providers';
import { paymentRecordsTable as pay } from '../db/schema/records';
import { ApiHttpError } from '../http-error';
import { fetchOne, resolveProviderTarget, statusAgrees } from '../reconciliation/provider-checks';
import { outcome, type Outcome } from './repair-actions';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PaymentStatus = typeof pay.$inferSelect.status;
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

export type PaymentRefreshPlan = {
  paymentId: string;
  version: number;
  set: { status: PaymentStatus; amountMinor: bigint; currency: string };
  previousState: Record<string, unknown>;
  resultingState: Record<string, unknown>;
};

const view = (status: string, amountMinor: bigint, currency: string) => ({
  status,
  amountMinor: amountMinor.toString(),
  currency,
});

function notConfigured(reason: string) {
  return new ApiHttpError(
    409,
    'PROVIDER_NOT_CONFIGURED',
    `The provider connection cannot fetch records (${reason})`,
  );
}

export async function planPaymentRefresh(
  db: Db,
  deps: ProviderDeps,
  orgId: string,
  paymentId: string,
): Promise<PaymentRefreshPlan> {
  const [row] = await db
    .select({
      status: pay.status,
      amountMinor: pay.amountMinor,
      amountRefundedMinor: pay.amountRefundedMinor,
      currency: pay.currency,
      version: pay.version,
      providerPaymentId: pay.providerPaymentId,
      connectionId: conn.id,
      provider: conn.provider,
      connectionStatus: conn.status,
      credentialsCiphertext: conn.credentialsCiphertext,
    })
    .from(pay)
    .innerJoin(conn, and(eq(conn.orgId, pay.orgId), eq(conn.id, pay.connectionId)))
    .where(and(eq(pay.orgId, orgId), eq(pay.id, paymentId)));
  if (!row) throw new ApiHttpError(404, 'NOT_FOUND', 'Payment not found');
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
  if (!resolved.ok) throw notConfigured(resolved.reason);
  if (!resolved.target.adapter.fetchPayment) throw notConfigured('payment_fetch_unsupported');

  const res = await fetchOne(resolved.target, 'payment', row.providerPaymentId);
  if (res.kind === 'not_found') {
    throw new ApiHttpError(409, 'PROVIDER_OBJECT_NOT_FOUND', 'The provider has no such payment');
  }
  if (res.kind === 'unavailable') {
    throw new ApiHttpError(502, 'PROVIDER_UNAVAILABLE', 'The provider is unreachable');
  }
  if (res.kind !== 'ok') {
    throw new ApiHttpError(502, 'PROVIDER_FETCH_FAILED', 'The provider request failed');
  }
  const remote = res.status.toLowerCase().replace('cancelled', 'canceled');
  const status = statusAgrees(row.status, res.status)
    ? row.status
    : PROVIDER_PAYMENT_STATUS[remote];
  if (!status) {
    throw new ApiHttpError(
      422,
      'PROVIDER_STATUS_UNMAPPED',
      `Provider status ${res.status} has no local equivalent`,
    );
  }
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
    paymentId,
    version: row.version,
    set: { status, amountMinor, currency },
    previousState: view(row.status, row.amountMinor, row.currency),
    resultingState: { ...view(status, amountMinor, currency), providerStatus: res.status },
  };
}

export async function applyPaymentRefresh(
  tx: Tx,
  orgId: string,
  plan: PaymentRefreshPlan,
): Promise<Outcome> {
  const [row] = await tx
    .update(pay)
    .set({
      ...plan.set,
      // Webhooks that occurred before this read are already reflected and must not revert it.
      lastEventAt: sql`greatest(${pay.lastEventAt}, now())`,
      version: sql`${pay.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(pay.orgId, orgId), eq(pay.id, plan.paymentId), eq(pay.version, plan.version)))
    .returning({ id: pay.id });
  if (!row) {
    throw new ApiHttpError(
      409,
      'CONCURRENT_UPDATE',
      'The payment changed while the provider was being read',
    );
  }
  return outcome('refresh_from_provider', plan.paymentId, plan.previousState, plan.resultingState);
}
