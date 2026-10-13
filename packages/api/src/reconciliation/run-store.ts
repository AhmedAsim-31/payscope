import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { openIncidentsForFindings } from '../incidents/incident-open';
import { reconciliationRunsTable as r } from '../db/schema/reconciliation';
import { upsertFindings, type FindingDraft } from './finding-upsert';

export type Checkpoint = { phase: string; after: string | null; requests: number };

const checkpointSchema = z.object({
  phase: z.string(),
  after: z.string().nullable().default(null),
  requests: z.number().int().default(0),
});

export type BatchDelta = {
  examined: number;
  matched: number;
  mismatched: number;
  unavailable: number;
  failed: number;
};

export class RunNotRunningError extends Error {
  constructor(runId: string) {
    super(`reconciliation run ${runId} is no longer running`);
    this.name = 'RunNotRunningError';
  }
}

export function parseCheckpoint(value: unknown): Checkpoint | undefined {
  const parsed = checkpointSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function loadRun(db: Db, orgId: string, runId: string) {
  const [run] = await db
    .select()
    .from(r)
    .where(and(eq(r.orgId, orgId), eq(r.id, runId)));
  return run;
}

export async function commitBatch(
  db: Db,
  run: { id: string; orgId: string },
  drafts: FindingDraft[],
  delta: BatchDelta,
  checkpoint: Checkpoint,
): Promise<void> {
  await db.transaction(async (tx) => {
    await upsertFindings(tx, run.orgId, run.id, drafts);
    await openIncidentsForFindings(tx, run.orgId, run.id, drafts);
    const updated = await tx
      .update(r)
      .set({
        examinedCount: sql`${r.examinedCount} + ${delta.examined}`,
        matchedCount: sql`${r.matchedCount} + ${delta.matched}`,
        mismatchedCount: sql`${r.mismatchedCount} + ${delta.mismatched}`,
        unavailableCount: sql`${r.unavailableCount} + ${delta.unavailable}`,
        failedCount: sql`${r.failedCount} + ${delta.failed}`,
        checkpoint,
      })
      .where(and(eq(r.id, run.id), eq(r.orgId, run.orgId), eq(r.status, 'running')))
      .returning({ id: r.id });
    if (updated.length === 0) throw new RunNotRunningError(run.id);
  });
}

export type Outcome = { status: 'failed' | 'partial'; error: string } | undefined;

/** Without a forced outcome, unverified or failed objects make the run partial. */
export async function finishRun(
  db: Db,
  run: { id: string; orgId: string },
  forced: Outcome,
): Promise<void> {
  const status = forced
    ? sql`${forced.status}::reconciliation_run_status`
    : sql`(case when ${r.failedCount} > 0 or ${r.unavailableCount} > 0 then 'partial' else 'completed' end)::reconciliation_run_status`;
  await db
    .update(r)
    .set({ status, error: forced?.error ?? null, finishedAt: sql`now()` })
    .where(and(eq(r.id, run.id), eq(r.orgId, run.orgId), eq(r.status, 'running')));
}
