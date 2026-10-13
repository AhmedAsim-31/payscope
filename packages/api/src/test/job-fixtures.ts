import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

export type JobRow = {
  status: string;
  attempt_count: number;
  locked_by: string | null;
  lease_expires_at: Date | null;
  available_at: Date;
  last_error: string | null;
};

export const uniqueKind = () => `test_${randomUUID()}`;

export async function insertJobs(
  sql: postgres.Sql,
  kind: string,
  count: number,
  maxAttempts = 5,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    insert into background_jobs (kind, max_attempts)
    select ${kind}, ${maxAttempts}::int from generate_series(1, ${count}::int)
    returning id`;
  return rows.map((r) => r.id);
}

export async function jobRow(sql: postgres.Sql, id: string): Promise<JobRow> {
  const [row] = await sql<JobRow[]>`
    select status, attempt_count, locked_by, lease_expires_at, available_at, last_error
    from background_jobs where id = ${id}`;
  if (!row) throw new Error(`job ${id} not found`);
  return {
    ...row,
    available_at: new Date(row.available_at),
    lease_expires_at: row.lease_expires_at && new Date(row.lease_expires_at),
  };
}

export async function makeAvailable(sql: postgres.Sql, id: string): Promise<void> {
  await sql`update background_jobs set available_at = now() - interval '1 second' where id = ${id}`;
}

export async function expireLease(sql: postgres.Sql, id: string): Promise<void> {
  await sql`update background_jobs set lease_expires_at = now() - interval '1 second' where id = ${id}`;
}

export async function parkQueuedJobs(sql: postgres.Sql): Promise<void> {
  await sql`update background_jobs set available_at = now() + interval '1 day' where status = 'queued'`;
}
