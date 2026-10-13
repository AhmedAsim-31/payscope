import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { findingQuerySchema, runQuerySchema } from '@payscope/shared/reconciliation-schemas';
import type { Db } from '../db/client';
import {
  reconciliationFindingsTable as f,
  reconciliationRunsTable as r,
} from '../db/schema/reconciliation';
import { cursorTsColumn, iso, isoOrNull, keysetAfter, toPage } from '../records/keyset';

type FindingQuery = z.output<typeof findingQuerySchema>;
type RunQuery = z.output<typeof runQuerySchema>;

const runColumns = { run: r, cursorTs: cursorTsColumn(r.startedAt) };

type RunRow = typeof r.$inferSelect;

function toRun(row: RunRow) {
  return {
    id: row.id,
    connectionId: row.connectionId,
    mode: row.mode,
    trigger: row.trigger,
    status: row.status,
    counts: {
      examined: row.examinedCount,
      matched: row.matchedCount,
      mismatched: row.mismatchedCount,
      unavailable: row.unavailableCount,
      failed: row.failedCount,
    },
    error: row.error,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    triggeredBy: row.triggeredBy,
  };
}

export function toRunDetail(row: RunRow) {
  return {
    ...toRun(row),
    scope: asRecord(row.scope),
    checkpoint: asRecord(row.checkpoint),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

export async function listRuns(db: Db, orgId: string, q: RunQuery) {
  const rows = await db
    .select(runColumns)
    .from(r)
    .where(and(eq(r.orgId, orgId), keysetAfter(r.startedAt, r.id, q.cursor)))
    .orderBy(desc(r.startedAt), desc(r.id))
    .limit(q.limit + 1);
  return toPage(
    rows.map((x) => ({ ...x, id: x.run.id })),
    q.limit,
    (x) => toRun(x.run),
  );
}

export async function getRun(db: Db, orgId: string, runId: string) {
  const [row] = await db
    .select()
    .from(r)
    .where(and(eq(r.orgId, orgId), eq(r.id, runId)));
  return row ? toRunDetail(row) : undefined;
}

type FindingRow = typeof f.$inferSelect;

function toFinding(row: FindingRow) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    recommendedAction: row.recommendedAction,
    firstSeenRunId: row.firstSeenRunId,
    lastSeenRunId: row.lastSeenRunId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toFindingDetail(row: FindingRow) {
  return {
    ...toFinding(row),
    fingerprint: row.fingerprint,
    evidence: asRecord(row.evidence),
    resolvedAt: isoOrNull(row.resolvedAt),
    resolutionNote: row.resolutionNote,
  };
}

export async function listFindings(db: Db, orgId: string, q: FindingQuery) {
  const where: (SQL | undefined)[] = [
    eq(f.orgId, orgId),
    q.type === undefined ? undefined : eq(f.type, q.type),
    q.status === undefined ? undefined : eq(f.status, q.status),
    q.severity === undefined ? undefined : eq(f.severity, q.severity),
    keysetAfter(f.createdAt, f.id, q.cursor),
  ];
  const rows = await db
    .select({ finding: f, cursorTs: cursorTsColumn(f.createdAt) })
    .from(f)
    .where(and(...where))
    .orderBy(desc(f.createdAt), desc(f.id))
    .limit(q.limit + 1);
  return toPage(
    rows.map((x) => ({ ...x, id: x.finding.id })),
    q.limit,
    (x) => toFinding(x.finding),
  );
}

export async function getFinding(db: Pick<Db, 'select'>, orgId: string, findingId: string) {
  const [row] = await db
    .select()
    .from(f)
    .where(and(eq(f.orgId, orgId), eq(f.id, findingId)));
  return row;
}

/** Resolved is reserved for the repair flow, so only open or reviewed findings can be triaged. */
export async function triageFinding(
  db: Pick<Db, 'update'>,
  orgId: string,
  findingId: string,
  status: 'reviewed' | 'dismissed',
  note: string,
) {
  const [row] = await db
    .update(f)
    .set({ status, resolutionNote: note, updatedAt: sql`now()` })
    .where(and(eq(f.orgId, orgId), eq(f.id, findingId), inArray(f.status, ['open', 'reviewed'])))
    .returning();
  return row;
}
