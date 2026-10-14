import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { incidentQuerySchema } from '@payscope/shared/incident-schemas';
import type { Db } from '../db/client';
import { incidentActionsTable as a, incidentsTable as i } from '../db/schema/operations';
import { cursorTsColumn, iso, isoOrNull, keysetAfter, toPage } from '../records/keyset';

type Query = z.output<typeof incidentQuerySchema>;
type Row = typeof i.$inferSelect;

export function toIncident(row: Row) {
  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    status: row.status,
    title: row.title,
    findingCount: row.findingCount,
    openedAt: iso(row.openedAt),
    lastSeenAt: iso(row.lastSeenAt),
    resolvedAt: isoOrNull(row.resolvedAt),
  };
}

export async function listIncidents(db: Db, orgId: string, q: Query) {
  const rows = await db
    .select({ incident: i, cursorTs: cursorTsColumn(i.openedAt) })
    .from(i)
    .where(
      and(
        eq(i.orgId, orgId),
        q.status === undefined ? undefined : eq(i.status, q.status),
        q.severity === undefined ? undefined : eq(i.severity, q.severity),
        q.category === undefined ? undefined : eq(i.category, q.category),
        keysetAfter(i.openedAt, i.id, q.cursor),
      ),
    )
    .orderBy(desc(i.openedAt), desc(i.id))
    .limit(q.limit + 1);
  return toPage(
    rows.map((x) => ({ ...x, id: x.incident.id })),
    q.limit,
    (x) => toIncident(x.incident),
  );
}

export async function getIncident(db: Pick<Db, 'select'>, orgId: string, incidentId: string) {
  const [row] = await db
    .select()
    .from(i)
    .where(and(eq(i.orgId, orgId), eq(i.id, incidentId)));
  return row;
}

export async function getIncidentDetail(db: Db, orgId: string, incidentId: string) {
  const row = await getIncident(db, orgId, incidentId);
  if (!row) return undefined;
  const actions = await db
    .select()
    .from(a)
    .where(and(eq(a.orgId, orgId), eq(a.incidentId, incidentId)))
    .orderBy(asc(a.createdAt), asc(a.id))
    .limit(200);
  return {
    ...toIncident(row),
    related: typeof row.related === 'object' && row.related !== null ? { ...row.related } : {},
    resolutionNotes: row.resolutionNotes,
    actions: actions.map((x) => ({
      id: x.id,
      actorId: x.actorId,
      action: x.action,
      note: x.note,
      createdAt: iso(x.createdAt),
    })),
  };
}

type Executor = Pick<Db, 'update' | 'insert'>;

/** The status precondition lives in the WHERE clause; undefined means the transition was not allowed. */
export async function transitionIncident(
  tx: Executor,
  orgId: string,
  incidentId: string,
  action: 'acknowledge' | 'resolve',
  note: string,
) {
  const [row] = await tx
    .update(i)
    .set(
      action === 'acknowledge'
        ? { status: 'investigating' }
        : { status: 'resolved', resolvedAt: sql`now()`, resolutionNotes: note },
    )
    .where(
      and(
        eq(i.orgId, orgId),
        eq(i.id, incidentId),
        action === 'acknowledge' ? eq(i.status, 'open') : ne(i.status, 'resolved'),
      ),
    )
    .returning();
  return row;
}

export async function recordIncidentAction(
  tx: Pick<Db, 'insert'>,
  input: {
    orgId: string;
    incidentId: string;
    actorId: string | null;
    action: string;
    note: string;
  },
): Promise<void> {
  await tx.insert(a).values(input);
}
