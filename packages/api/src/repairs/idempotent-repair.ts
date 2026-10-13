import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { repairResultSchema, type RepairResult } from '@payscope/shared/repair-schemas';
import { audited, type AuditedWork } from '../audit/audit-log';
import type { Db } from '../db/client';
import { idempotencyRecordsTable as idem } from '../db/schema/jobs';
import { ApiHttpError } from '../http-error';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type RepairInput = {
  orgId: string;
  actorId: string;
  requestId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  idempotencyKey: string;
  body: unknown;
};

/** The key claim, the repair, its audit row and the stored response commit or roll back together. */
export async function runRepair(
  db: Db,
  input: RepairInput,
  work: (tx: Tx) => Promise<AuditedWork<RepairResult>>,
): Promise<RepairResult> {
  const scope = `repair:${input.action}`;
  const requestHash = createHash('sha256').update(JSON.stringify(input.body)).digest('hex');
  return audited(
    db,
    {
      orgId: input.orgId,
      actorId: input.actorId,
      requestId: input.requestId,
      action: `repair.${input.action}`,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
    },
    async (tx) => {
      const [claimed] = await tx
        .insert(idem)
        .values({
          orgId: input.orgId,
          scope,
          key: input.idempotencyKey,
          requestHash,
          expiresAt: sql`now() + interval '24 hours'`,
        })
        .onConflictDoUpdate({
          target: [idem.orgId, idem.scope, idem.key],
          set: {
            requestHash,
            responseStatus: null,
            responseBody: null,
            createdAt: sql`now()`,
            expiresAt: sql`now() + interval '24 hours'`,
          },
          setWhere: sql`${idem.expiresAt} < now()`,
        })
        .returning({ id: idem.id });
      if (!claimed) {
        const [existing] = await tx
          .select({ requestHash: idem.requestHash, body: idem.responseBody })
          .from(idem)
          .where(
            sql`${idem.orgId} = ${input.orgId} and ${idem.scope} = ${scope} and ${idem.key} = ${input.idempotencyKey}`,
          );
        if (!existing || existing.requestHash !== requestHash) {
          throw new ApiHttpError(
            422,
            'IDEMPOTENCY_KEY_REUSED',
            'Idempotency-Key was already used with a different request',
          );
        }
        return { value: repairResultSchema.parse(existing.body), skip: true };
      }
      const done = await work(tx);
      await tx
        .update(idem)
        .set({ responseStatus: 200, responseBody: done.value })
        .where(eq(idem.id, claimed.id));
      return done;
    },
  );
}
