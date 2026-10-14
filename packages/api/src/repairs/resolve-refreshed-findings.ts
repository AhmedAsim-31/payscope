import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { writeAudit } from '../audit/audit-log';
import type { Db } from '../db/client';
import { reconciliationFindingsTable as f } from '../db/schema/reconciliation';
import { ApiHttpError } from '../http-error';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type SubjectType = 'payment' | 'subscription';
export type RefreshActor = { orgId: string; actorId: string; requestId: string; reason: string };

export class AlreadyConsistentError extends ApiHttpError {
  constructor(
    readonly subjectType: SubjectType,
    readonly subjectId: string,
    readonly matchesProvider: boolean,
  ) {
    super(409, 'ALREADY_CONSISTENT', `The ${subjectType} already matches the provider`);
  }
}

/** Commits on its own because the repair transaction rolls back with the 409. */
export async function settleAlreadyConsistent(
  db: Db,
  actor: RefreshActor,
  err: AlreadyConsistentError,
): Promise<ApiHttpError> {
  const resolvedFindingIds = err.matchesProvider
    ? await db.transaction((tx) =>
        resolveRefreshedFindings(tx, actor, err.subjectType, err.subjectId),
      )
    : [];
  return new ApiHttpError(409, err.code, err.message, { resolvedFindingIds });
}

/** One conditional UPDATE so a finding triaged concurrently is never resolved over its new state. */
export async function resolveRefreshedFindings(
  tx: Tx,
  actor: RefreshActor,
  subjectType: SubjectType,
  subjectId: string,
): Promise<string[]> {
  const prior = alias(f, 'prior');
  const resolved = await tx
    .update(f)
    .set({
      status: 'resolved',
      resolvedAt: sql`now()`,
      resolutionNote: actor.reason,
      updatedAt: sql`now()`,
    })
    .from(prior)
    .where(
      and(
        eq(prior.id, f.id),
        eq(f.orgId, actor.orgId),
        eq(f.subjectType, subjectType),
        eq(f.subjectId, subjectId),
        eq(f.type, 'status_mismatch'),
        inArray(f.status, ['open', 'reviewed']),
      ),
    )
    .returning({ id: f.id, previousStatus: prior.status });
  for (const row of resolved) {
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.actorId,
      requestId: actor.requestId,
      action: 'finding.resolve',
      targetType: 'finding',
      targetId: row.id,
      reason: actor.reason,
      previousState: { status: row.previousStatus },
      resultingState: { status: 'resolved', via: 'refresh_from_provider' },
    });
  }
  return resolved.map((row) => row.id);
}
