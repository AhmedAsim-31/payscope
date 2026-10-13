import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import { auditLogsTable } from '../db/schema/operations';
import { ApiHttpError } from '../http-error';
import { currentOrg, currentUserId } from '../orgs/request-context';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type State = Record<string, unknown>;

export type AuditEntry = {
  orgId: string;
  actorId: string | null;
  actorType?: 'user' | 'system';
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  previousState?: State | null;
  resultingState?: State | null;
  outcome?: 'success' | 'failure';
  requestId?: string | null;
};

/** Callers pass the transaction of the mutation being recorded, so both commit or neither does. */
export async function writeAudit(executor: Pick<Db, 'insert'>, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogsTable).values({
    orgId: entry.orgId,
    actorId: entry.actorId,
    actorType: entry.actorType ?? (entry.actorId ? 'user' : 'system'),
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    reason: entry.reason ?? null,
    previousState: entry.previousState ?? null,
    resultingState: entry.resultingState ?? null,
    outcome: entry.outcome ?? 'success',
    requestId: entry.requestId ?? null,
  });
}

export function auditContext(request: FastifyRequest) {
  return { orgId: currentOrg(request).id, actorId: currentUserId(request), requestId: request.id };
}

export type AuditedWork<T> = {
  value: T;
  skip?: boolean;
  targetId?: string | null;
  previousState?: State | null;
  resultingState?: State | null;
};

type AuditedBase = Omit<AuditEntry, 'outcome' | 'previousState' | 'resultingState'>;

/** Success audits inside the work's transaction; a rejected request is audited as a failure after the rollback. */
export async function audited<T>(
  db: Db,
  base: AuditedBase,
  work: (tx: Tx) => Promise<AuditedWork<T>>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      const done = await work(tx);
      if (done.skip) return done.value;
      await writeAudit(tx, {
        ...base,
        targetId: done.targetId ?? base.targetId,
        previousState: done.previousState,
        resultingState: done.resultingState,
      });
      return done.value;
    });
  } catch (err) {
    if (err instanceof ApiHttpError) {
      await writeAudit(db, {
        ...base,
        outcome: 'failure',
        resultingState: { error: err.code, status: err.statusCode },
      });
    }
    throw err;
  }
}
