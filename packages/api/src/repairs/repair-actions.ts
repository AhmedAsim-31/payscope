import { and, eq, inArray, sql } from 'drizzle-orm';
import { entitlementMapSchema } from '../connections/entitlement-map';
import type { Db } from '../db/client';
import { providerEventsTable } from '../db/schema/events';
import { backgroundJobsTable } from '../db/schema/jobs';
import { providerConnectionsTable } from '../db/schema/providers';
import {
  entitlementRecordsTable as ent,
  subscriptionRecordsTable as sub,
} from '../db/schema/records';
import { reconciliationFindingsTable as f } from '../db/schema/reconciliation';
import { ApiHttpError } from '../http-error';
import { PROCESS_EVENT_JOB_KIND } from '../webhooks/ingest-event';
import { enqueueJob } from '../jobs/job-queue';
import { evidenceString } from './evidence';
import { recheckFinding } from './finding-recheck';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Finding = typeof f.$inferSelect;
type Outcome = {
  value: {
    action: 'reprocess_event' | 'correct_entitlement' | 'resolve_finding';
    targetId: string;
    previousState: Record<string, unknown>;
    resultingState: Record<string, unknown>;
  };
  previousState: Record<string, unknown>;
  resultingState: Record<string, unknown>;
};

const REPROCESSABLE = ['processed', 'ignored', 'failed', 'needs_attention'] as const;

function outcome(
  action: Outcome['value']['action'],
  targetId: string,
  previousState: Record<string, unknown>,
  resultingState: Record<string, unknown>,
): Outcome {
  return {
    value: { action, targetId, previousState, resultingState },
    previousState,
    resultingState,
  };
}

export async function loadOpenFinding(tx: Tx, orgId: string, findingId: string): Promise<Finding> {
  const [finding] = await tx
    .select()
    .from(f)
    .where(and(eq(f.orgId, orgId), eq(f.id, findingId)))
    .for('update');
  if (!finding) throw new ApiHttpError(404, 'NOT_FOUND', 'Finding not found');
  if (finding.status === 'resolved' || finding.status === 'dismissed') {
    throw new ApiHttpError(409, 'FINDING_CLOSED', 'Finding is already resolved or dismissed');
  }
  return finding;
}

async function markResolved(tx: Tx, orgId: string, findingId: string, note: string) {
  const [row] = await tx
    .update(f)
    .set({
      status: 'resolved',
      resolvedAt: sql`now()`,
      resolutionNote: note,
      updatedAt: sql`now()`,
    })
    .where(and(eq(f.orgId, orgId), eq(f.id, findingId), inArray(f.status, ['open', 'reviewed'])))
    .returning({ id: f.id });
  if (!row)
    throw new ApiHttpError(409, 'FINDING_CLOSED', 'Finding is already resolved or dismissed');
}

export async function reprocessEvent(tx: Tx, orgId: string, eventId: string): Promise<Outcome> {
  const [event] = await tx
    .select({ status: providerEventsTable.status, prunedAt: providerEventsTable.payloadPrunedAt })
    .from(providerEventsTable)
    .where(and(eq(providerEventsTable.orgId, orgId), eq(providerEventsTable.id, eventId)))
    .for('update');
  if (!event) throw new ApiHttpError(404, 'NOT_FOUND', 'Event not found');
  if (event.prunedAt) {
    throw new ApiHttpError(409, 'PAYLOAD_PRUNED', 'Event payload was removed by retention');
  }
  const [reset] = await tx
    .update(providerEventsTable)
    .set({ status: 'pending' })
    .where(
      and(
        eq(providerEventsTable.orgId, orgId),
        eq(providerEventsTable.id, eventId),
        inArray(providerEventsTable.status, [...REPROCESSABLE]),
      ),
    )
    .returning({ id: providerEventsTable.id });
  if (!reset) {
    throw new ApiHttpError(
      409,
      'EVENT_IN_FLIGHT',
      `Event is ${event.status} and cannot be reprocessed`,
    );
  }
  const [requeued] = await tx
    .update(backgroundJobsTable)
    .set({ status: 'queued', attemptCount: 0, availableAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(backgroundJobsTable.orgId, orgId),
        eq(backgroundJobsTable.idempotencyKey, `event:${eventId}`),
        inArray(backgroundJobsTable.status, ['succeeded', 'failed', 'dead']),
      ),
    )
    .returning({ id: backgroundJobsTable.id });
  if (!requeued) {
    const created = await enqueueJob(tx, {
      kind: PROCESS_EVENT_JOB_KIND,
      payload: { eventId },
      orgId,
      idempotencyKey: `event:${eventId}`,
    });
    if (!created) throw new ApiHttpError(409, 'EVENT_IN_FLIGHT', 'Event job is already queued');
  }
  return outcome(
    'reprocess_event',
    eventId,
    { eventStatus: event.status },
    { eventStatus: 'pending', jobStatus: 'queued' },
  );
}

async function grantEntitlements(tx: Tx, finding: Finding) {
  const subscriptionId = evidenceString(finding.evidence, 'subscriptionId');
  const [row] = subscriptionId
    ? await tx
        .select({
          customerId: sub.customerId,
          planRef: sub.planRef,
          status: sub.status,
          periodEnd: sub.currentPeriodEnd,
          map: providerConnectionsTable.entitlementMap,
        })
        .from(sub)
        .innerJoin(providerConnectionsTable, eq(providerConnectionsTable.id, sub.connectionId))
        .where(and(eq(sub.orgId, finding.orgId), eq(sub.id, subscriptionId)))
        .for('update', { of: sub })
    : [];
  if (!row || (row.status !== 'active' && row.status !== 'trialing')) {
    throw new ApiHttpError(409, 'SUBSCRIPTION_NOT_ACTIVE', 'The subscription is no longer active');
  }
  const keys = row.planRef ? entitlementMapSchema.catch({}).parse(row.map)[row.planRef] : undefined;
  if (!keys || keys.length === 0) {
    throw new ApiHttpError(
      422,
      'PLAN_UNMAPPED',
      'The subscription plan maps to no entitlement keys',
    );
  }
  const changed = await tx
    .insert(ent)
    .values(
      keys.map((entitlementKey) => ({
        orgId: finding.orgId,
        customerId: row.customerId,
        subscriptionId: subscriptionId ?? null,
        entitlementKey,
        state: 'active' as const,
        source: 'manual_repair' as const,
        grantedAt: new Date(),
        expiresAt: row.periodEnd,
      })),
    )
    .onConflictDoUpdate({
      target: [ent.orgId, ent.customerId, ent.entitlementKey],
      set: {
        state: 'active',
        source: 'manual_repair',
        grantedAt: sql`now()`,
        revokedAt: null,
        expiresAt: row.periodEnd,
        subscriptionId: subscriptionId ?? null,
        version: sql`${ent.version} + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${ent.state} <> 'active'`,
    })
    .returning({ id: ent.id });
  if (changed.length === 0) {
    throw new ApiHttpError(409, 'ALREADY_CONSISTENT', 'The customer already has the entitlement');
  }
  return outcome(
    'correct_entitlement',
    finding.id,
    { entitlements: 'none active' },
    { entitlements: 'active', keys },
  );
}

async function expireEntitlement(tx: Tx, finding: Finding) {
  const entitlementId = evidenceString(finding.evidence, 'entitlementId');
  const [row] = entitlementId
    ? await tx
        .update(ent)
        .set({
          state: 'expired',
          source: 'manual_repair',
          version: sql`${ent.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(ent.orgId, finding.orgId),
            eq(ent.id, entitlementId),
            eq(ent.state, 'active'),
            sql`exists (select 1 from ${sub} s where s.org_id = ${ent.orgId} and s.id = ${ent.subscriptionId}
              and ((s.status = 'expired' and (s.current_period_end is null or s.current_period_end < now()))
                or (s.status = 'canceled' and s.current_period_end < now())))`,
          ),
        )
        .returning({ key: ent.entitlementKey })
    : [];
  if (!row) {
    throw new ApiHttpError(
      409,
      'ALREADY_CONSISTENT',
      'The entitlement is no longer active or the subscription is',
    );
  }
  return outcome(
    'correct_entitlement',
    finding.id,
    { entitlement: 'active', key: row.key },
    { entitlement: 'expired', key: row.key },
  );
}

export async function correctEntitlement(
  tx: Tx,
  orgId: string,
  findingId: string,
  reason: string,
): Promise<Outcome> {
  const finding = await loadOpenFinding(tx, orgId, findingId);
  let done: Outcome;
  if (finding.type === 'entitlement_missing_or_stale') done = await grantEntitlements(tx, finding);
  else if (finding.type === 'expired_externally_active_locally') {
    done = await expireEntitlement(tx, finding);
  } else {
    throw new ApiHttpError(
      422,
      'NOT_CORRECTABLE',
      'This finding type has no entitlement correction',
    );
  }
  await markResolved(tx, orgId, findingId, reason);
  return done;
}

export async function resolveFinding(
  tx: Tx,
  orgId: string,
  findingId: string,
  reason: string,
): Promise<Outcome> {
  const finding = await loadOpenFinding(tx, orgId, findingId);
  const check = await recheckFinding(tx, finding);
  if (!check.verifiable) {
    throw new ApiHttpError(
      422,
      'NOT_LOCALLY_VERIFIABLE',
      'This finding cannot be re-checked locally',
    );
  }
  if (check.stillDetected) {
    throw new ApiHttpError(409, 'STILL_DETECTED', 'The inconsistency is still detected locally');
  }
  await markResolved(tx, orgId, findingId, reason);
  return outcome('resolve_finding', findingId, { status: finding.status }, { status: 'resolved' });
}
