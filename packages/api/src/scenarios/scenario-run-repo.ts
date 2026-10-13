import { and, desc, eq, sql } from 'drizzle-orm';
import {
  SCENARIOS,
  scenarioResultSchema,
  type ScenarioCatalogItem,
  type ScenarioResult,
  type ScenarioRun,
} from '@payscope/shared/scenario-schemas';
import type { Db } from '../db/client';
import { demoScenarioRunsTable as t } from '../db/schema/scenarios';

type Row = typeof t.$inferSelect;

export function toScenarioRun(row: Row): ScenarioRun {
  const parsed = scenarioResultSchema.safeParse(row.result);
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error,
    result: parsed.success ? parsed.data : null,
  };
}

export async function getScenarioRun(db: Pick<Db, 'select'>, orgId: string, runId: string) {
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.orgId, orgId), eq(t.id, runId)));
  return row;
}

export async function hasRunningScenario(db: Pick<Db, 'select'>, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.orgId, orgId), eq(t.status, 'running')))
    .limit(1);
  return rows.length > 0;
}

export async function finishScenarioRun(
  db: Db,
  runId: string,
  outcome: { status: 'passed' | 'failed' | 'errored'; result?: ScenarioResult; error?: string },
): Promise<void> {
  await db
    .update(t)
    .set({
      status: outcome.status,
      result: outcome.result ?? null,
      error: outcome.error ?? null,
      finishedAt: sql`now()`,
    })
    .where(and(eq(t.id, runId), eq(t.status, 'running')));
}

export async function listCatalog(db: Db, orgId: string): Promise<ScenarioCatalogItem[]> {
  const rows = await db
    .selectDistinctOn([t.scenarioId])
    .from(t)
    .where(eq(t.orgId, orgId))
    .orderBy(t.scenarioId, desc(t.startedAt));
  const last = new Map(rows.map((r) => [r.scenarioId, toScenarioRun(r)]));
  return SCENARIOS.map((s) => ({
    ...s,
    mode: 'Local simulation' as const,
    lastRun: last.get(s.id) ?? null,
  }));
}
