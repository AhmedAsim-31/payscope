import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { backgroundJobsTable } from '../db/schema/jobs';

export type Job = {
  id: string;
  orgId: string | null;
  kind: string;
  payload: unknown;
  attemptCount: number;
  maxAttempts: number;
};

export type EnqueueInput = {
  kind: string;
  payload: object;
  orgId: string | null;
  idempotencyKey?: string;
  availableAt?: Date;
};

export async function enqueueJob(
  executor: Pick<Db, 'insert'>,
  input: EnqueueInput,
): Promise<{ id: string } | undefined> {
  const [row] = await executor
    .insert(backgroundJobsTable)
    .values({
      kind: input.kind,
      payload: input.payload,
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      availableAt: input.availableAt,
    })
    .onConflictDoNothing({ target: backgroundJobsTable.idempotencyKey })
    .returning({ id: backgroundJobsTable.id });
  return row;
}

export type ClaimInput = {
  workerId: string;
  limit: number;
  leaseSeconds: number;
  onlyJobIds?: string[];
};

export async function claimJobs(db: Db, input: ClaimInput): Promise<Job[]> {
  const only = input.onlyJobIds
    ? sql`AND id IN (${sql.join(
        input.onlyJobIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const rows = await db.execute<Job>(sql`
    UPDATE background_jobs
    SET status = 'running',
        locked_by = ${input.workerId},
        lease_expires_at = now() + make_interval(secs => ${input.leaseSeconds}::double precision),
        attempt_count = attempt_count + 1,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM background_jobs
      WHERE status = 'queued' AND available_at <= now()
        ${only}
      ORDER BY available_at
      LIMIT ${input.limit}::int
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, org_id AS "orgId", kind, payload,
              attempt_count AS "attemptCount", max_attempts AS "maxAttempts"
  `);
  return [...rows];
}

export async function completeJob(db: Db, id: string, workerId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE background_jobs
    SET status = 'succeeded', locked_by = NULL, lease_expires_at = NULL,
        last_error = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND locked_by = ${workerId}
    RETURNING id
  `);
  return rows.length > 0;
}

export type FailInput = { error: string; retryable: boolean; nextAvailableAt: Date };

export async function failJob(
  db: Db,
  id: string,
  workerId: string,
  input: FailInput,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE background_jobs
    SET status = (CASE WHEN ${input.retryable}::boolean AND attempt_count < max_attempts
                       THEN 'queued' ELSE 'dead' END)::job_status,
        available_at = CASE WHEN ${input.retryable}::boolean AND attempt_count < max_attempts
                            THEN ${input.nextAvailableAt.toISOString()}::timestamptz
                            ELSE available_at END,
        locked_by = NULL, lease_expires_at = NULL,
        last_error = left(${input.error}, 1000), updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND locked_by = ${workerId}
    RETURNING id
  `);
  return rows.length > 0;
}

export async function extendLease(
  db: Db,
  id: string,
  workerId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE background_jobs
    SET lease_expires_at = now() + make_interval(secs => ${leaseSeconds}::double precision),
        updated_at = now()
    WHERE id = ${id}::uuid AND status = 'running' AND locked_by = ${workerId}
    RETURNING id
  `);
  return rows.length > 0;
}

export async function recoverExpiredLeases(db: Db): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE background_jobs
    SET status = (CASE WHEN attempt_count >= max_attempts THEN 'dead' ELSE 'queued' END)::job_status,
        locked_by = NULL, lease_expires_at = NULL,
        last_error = 'lease_expired', updated_at = now()
    WHERE status = 'running' AND lease_expires_at < now()
    RETURNING id
  `);
  return rows.length;
}
