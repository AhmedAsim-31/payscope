import { and, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { writeAudit } from '../audit/audit-log';
import type { Db } from '../db/client';
import { incidentsTable as i } from '../db/schema/operations';
import { reconciliationFindingsTable as f } from '../db/schema/reconciliation';
import { recordIncidentAction } from './incident-repo';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type FindingType = (typeof f.$inferSelect)['type'];

const CLEARED_NOTE = 'All findings were resolved or dismissed';

/** Serializes incident writers per type so each recount's snapshot sees the previous writer's commit. */
export async function lockFindingType(
  executor: Pick<Db, 'execute'>,
  orgId: string,
  type: FindingType,
): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${type}))`);
}

/** Recounts the active incident for a finding type and resolves it, audited as system, once none remain. */
export async function refreshIncidentForFindingType(
  tx: Tx,
  orgId: string,
  type: FindingType,
  requestId: string,
): Promise<void> {
  await lockFindingType(tx, orgId, type);
  const live = sql`(select count(*)::int from ${f}
    where ${f.orgId} = ${orgId} and ${f.type} = ${type}
      and ${f.severity} in ('high', 'critical') and ${f.status} in ('open', 'reviewed'))`;
  const cleared = sql`${live} = 0`;
  const prior = alias(i, 'prior');
  const [row] = await tx
    .update(i)
    .set({
      findingCount: live,
      status: sql`case when ${cleared} then 'resolved'::incident_status else ${i.status} end`,
      resolvedAt: sql`case when ${cleared} then now() else ${i.resolvedAt} end`,
      resolutionNotes: sql`case when ${cleared} then ${CLEARED_NOTE} else ${i.resolutionNotes} end`,
    })
    .from(prior)
    .where(
      and(
        eq(prior.id, i.id),
        eq(i.orgId, orgId),
        eq(i.fingerprint, `finding_type:${type}`),
        ne(i.status, 'resolved'),
      ),
    )
    .returning({ id: i.id, status: i.status, previousStatus: prior.status });
  if (row?.status !== 'resolved') return;
  await recordIncidentAction(tx, {
    orgId,
    incidentId: row.id,
    actorId: null,
    action: 'resolve',
    note: CLEARED_NOTE,
  });
  await writeAudit(tx, {
    orgId,
    actorId: null,
    requestId,
    action: 'incident.resolve',
    targetType: 'incident',
    targetId: row.id,
    reason: CLEARED_NOTE,
    previousState: { status: row.previousStatus },
    resultingState: { status: 'resolved', via: 'findings_cleared' },
  });
}
