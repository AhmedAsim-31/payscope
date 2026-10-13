import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { incidentsTable } from '../db/schema/operations';
import { reconciliationFindingsTable as f } from '../db/schema/reconciliation';
import type { FindingDraft } from '../reconciliation/finding-upsert';

const RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;
const INCIDENT_SEVERITIES = ['high', 'critical'] as const;

/** One incident per finding type, deduplicated by the partial unique index; the count is recomputed from live findings. */
export async function openIncidentsForFindings(
  executor: Pick<Db, 'insert'>,
  orgId: string,
  runId: string,
  drafts: FindingDraft[],
): Promise<void> {
  const worst = new Map<FindingDraft['type'], FindingDraft['severity']>();
  for (const d of drafts) {
    if (!INCIDENT_SEVERITIES.some((s) => s === d.severity)) continue;
    const seen = worst.get(d.type);
    if (!seen || RANK[d.severity] > RANK[seen]) worst.set(d.type, d.severity);
  }
  for (const [type, severity] of worst) {
    const liveCount = sql<number>`(select count(*)::int from ${f}
      where ${f.orgId} = ${orgId} and ${f.type} = ${type}
        and ${f.severity} in ('high', 'critical') and ${f.status} in ('open', 'reviewed'))`;
    await executor
      .insert(incidentsTable)
      .values({
        orgId,
        category: type,
        severity,
        title: `Unresolved ${type.replaceAll('_', ' ')} findings`,
        fingerprint: `finding_type:${type}`,
        related: { findingType: type, lastRunId: runId },
        findingCount: liveCount,
      })
      .onConflictDoUpdate({
        target: [incidentsTable.orgId, incidentsTable.fingerprint],
        targetWhere: sql`${incidentsTable.status} <> 'resolved'`,
        set: {
          findingCount: liveCount,
          severity: sql`greatest(${incidentsTable.severity}, excluded.severity)`,
          related: sql`excluded.related`,
          lastSeenAt: sql`now()`,
        },
      });
  }
}
