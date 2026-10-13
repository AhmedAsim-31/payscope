import type { NormalizedEvent } from '@payscope/provider-adapters/normalized-event';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import { and, eq } from 'drizzle-orm';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { providerConnectionsTable as conn } from '../db/schema/providers';
import { paymentRecordsTable as pay } from '../db/schema/records';
import { findAdapter } from '../providers/adapter-registry';
import { resolveProviderTarget } from '../reconciliation/provider-checks';
import type { StoredEvent } from './apply-event';
import { subscriptionRefOf } from './payments';

/** Looked up before the apply transaction so no connection is held across the provider call. */
export async function withRefundSubscription(
  db: Db,
  adapters: AdapterRegistry,
  cipher: CredentialsCipher | undefined,
  fetchImpl: typeof fetch,
  stored: StoredEvent,
  event: NormalizedEvent,
): Promise<NormalizedEvent> {
  const adapter = findAdapter(adapters, event.provider);
  if (!adapter?.fetchPaymentSubscription || event.normalizedType !== 'payment.refunded') {
    return event;
  }
  if (subscriptionRefOf(event.metadata)) return event;
  const [row] = await db
    .select({
      linked: pay.providerSubscriptionId,
      id: conn.id,
      provider: conn.provider,
      credentialsCiphertext: conn.credentialsCiphertext,
    })
    .from(pay)
    .innerJoin(conn, and(eq(conn.id, pay.connectionId), eq(conn.orgId, pay.orgId)))
    .where(
      and(
        eq(pay.orgId, stored.orgId),
        eq(pay.connectionId, stored.connectionId),
        eq(pay.providerPaymentId, event.objectId),
      ),
    );
  if (!row || row.linked) return event;
  const resolved = resolveProviderTarget(row, adapters, cipher, fetchImpl);
  if (!resolved.ok) return event;
  const subscriptionId = await adapter.fetchPaymentSubscription?.(
    resolved.target.ctx,
    event.objectId,
  );
  return subscriptionId ? { ...event, metadata: { ...event.metadata, subscriptionId } } : event;
}
