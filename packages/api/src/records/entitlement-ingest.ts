import { and, eq, sql } from 'drizzle-orm';
import type {
  IngestEntitlementBody,
  IngestEntitlementResult,
} from '@payscope/shared/entitlement-ingest-schemas';
import type { AuditedWork } from '../audit/audit-log';
import type { Db } from '../db/client';
import { pgErrorCode } from '../db/pg-errors';
import { entitlementRecordsTable as t } from '../db/schema/records';
import { ApiHttpError } from '../http-error';
import { getEntitlement } from './entitlements-repo';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const FOREIGN_KEY_VIOLATION = '23503';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const toDate = (value: string | undefined) => (value ? new Date(value) : null);

/** A future observedAt would outrank every later real update, so it is refused up front. */
export function assertNotFuture(observedAt: string): void {
  if (new Date(observedAt).getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
    throw new ApiHttpError(422, 'OBSERVED_AT_IN_FUTURE', 'observedAt is in the future');
  }
}

/** One guarded upsert: a snapshot older than the row's last update is ignored, never merged. */
export async function ingestEntitlement(
  tx: Tx,
  orgId: string,
  body: IngestEntitlementBody,
): Promise<AuditedWork<IngestEntitlementResult>> {
  const observedAt = new Date(body.observedAt);
  const active = body.state === 'active';
  const naturalKey = and(
    eq(t.orgId, orgId),
    eq(t.customerId, body.customerId),
    eq(t.entitlementKey, body.entitlementKey),
  );
  const [previous] = await tx
    .select({ state: t.state, source: t.source })
    .from(t)
    .where(naturalKey)
    .for('update');
  let written: { id: string }[];
  try {
    written = await tx
      .insert(t)
      .values({
        orgId,
        customerId: body.customerId,
        subscriptionId: body.subscriptionId ?? null,
        entitlementKey: body.entitlementKey,
        state: body.state,
        source: 'ingestion_api',
        grantedAt: toDate(body.grantedAt) ?? (active ? observedAt : null),
        expiresAt: toDate(body.expiresAt),
        revokedAt: body.state === 'revoked' ? (toDate(body.revokedAt) ?? observedAt) : null,
        lastEventAt: observedAt,
      })
      .onConflictDoUpdate({
        target: [t.orgId, t.customerId, t.entitlementKey],
        set: {
          state: body.state,
          source: 'ingestion_api',
          ...(body.grantedAt
            ? { grantedAt: sql`excluded.granted_at` }
            : active
              ? {
                  grantedAt: sql`CASE WHEN ${t.state} = 'active' THEN ${t.grantedAt} ELSE excluded.granted_at END`,
                }
              : {}),
          expiresAt: sql`excluded.expires_at`,
          revokedAt: sql`excluded.revoked_at`,
          subscriptionId: sql`COALESCE(excluded.subscription_id, ${t.subscriptionId})`,
          lastEventAt: observedAt,
          version: sql`${t.version} + 1`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${t.lastEventAt} IS NULL OR ${t.lastEventAt} <= excluded.last_event_at`,
      })
      .returning({ id: t.id });
  } catch (err) {
    if (pgErrorCode(err) === FOREIGN_KEY_VIOLATION) {
      throw new ApiHttpError(404, 'NOT_FOUND', 'Customer or subscription not found');
    }
    throw err;
  }
  const applied = written.length > 0;
  const [row] = applied ? written : await tx.select({ id: t.id }).from(t).where(naturalKey);
  const entitlement = row && (await getEntitlement(tx, orgId, row.id));
  if (!entitlement) throw new Error('ingested entitlement vanished');
  return {
    value: { applied, entitlement },
    targetId: entitlement.id,
    previousState: previous ?? null,
    resultingState: { state: entitlement.state, applied, observedAt: body.observedAt },
  };
}
