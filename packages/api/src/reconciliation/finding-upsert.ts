import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { reconciliationFindingsTable as f } from '../db/schema/reconciliation';

type FindingInsert = typeof f.$inferInsert;

export type FindingDraft = Pick<
  FindingInsert,
  'type' | 'severity' | 'subjectType' | 'subjectId' | 'recommendedAction'
> & { key?: string; evidence: Record<string, unknown> };

export function fingerprintOf(d: FindingDraft): string {
  const parts = [d.type, d.subjectType, d.subjectId, d.key].filter((p) => p !== undefined);
  return parts.join(':');
}

/** Re-detection of an open or reviewed finding only refreshes last_seen and evidence. */
export async function upsertFindings(
  executor: Pick<Db, 'insert'>,
  orgId: string,
  runId: string,
  drafts: FindingDraft[],
): Promise<void> {
  const byFingerprint = new Map<string, FindingInsert>();
  for (const d of drafts) {
    const fingerprint = fingerprintOf(d);
    byFingerprint.set(fingerprint, {
      orgId,
      type: d.type,
      severity: d.severity,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      fingerprint,
      evidence: d.evidence,
      recommendedAction: d.recommendedAction,
      firstSeenRunId: runId,
      lastSeenRunId: runId,
    });
  }
  if (byFingerprint.size === 0) return;
  await executor
    .insert(f)
    .values([...byFingerprint.values()])
    .onConflictDoUpdate({
      target: [f.orgId, f.fingerprint],
      targetWhere: sql`${f.status} IN ('open', 'reviewed')`,
      set: {
        lastSeenRunId: sql`excluded.last_seen_run_id`,
        evidence: sql`excluded.evidence`,
        updatedAt: sql`now()`,
      },
    });
}
