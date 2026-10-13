import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { idempotencyRecordsTable as idem } from '../db/schema/jobs';
import { ApiHttpError } from '../http-error';
import { audited, type AuditEntry, type AuditedWork } from './audit-log';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type IdempotentInput<T> = {
  audit: Omit<AuditEntry, 'outcome' | 'previousState' | 'resultingState'>;
  scope: string;
  idempotencyKey: string;
  body: unknown;
  response: z.ZodType<T>;
};

/** The key claim, the work, its audit row and the stored response commit or roll back together. */
export async function idempotentAudited<T>(
  db: Db,
  input: IdempotentInput<T>,
  work: (tx: Tx) => Promise<AuditedWork<T>>,
): Promise<T> {
  const { orgId } = input.audit;
  const { scope, idempotencyKey: key } = input;
  const requestHash = createHash('sha256').update(JSON.stringify(input.body)).digest('hex');
  return audited(db, input.audit, async (tx) => {
    const [claimed] = await tx
      .insert(idem)
      .values({
        orgId,
        scope,
        key,
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
        .where(and(eq(idem.orgId, orgId), eq(idem.scope, scope), eq(idem.key, key)));
      if (!existing || existing.requestHash !== requestHash) {
        throw new ApiHttpError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with a different request',
        );
      }
      return { value: input.response.parse(existing.body), skip: true };
    }
    const done = await work(tx);
    await tx
      .update(idem)
      .set({ responseStatus: 200, responseBody: done.value })
      .where(eq(idem.id, claimed.id));
    return done;
  });
}
