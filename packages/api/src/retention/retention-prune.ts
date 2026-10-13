import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

export type RetentionPolicy = {
  eventPayloadDays: number;
  finishedJobDays: number;
  idempotencyGraceDays: number;
  scenarioRunDays: number;
  auditLogDays: number;
};

export type PruneCounts = {
  eventPayloads: number;
  backgroundJobs: number;
  idempotencyRecords: number;
  scenarioRuns: number;
  auditLogs: number;
};

export const RETENTION_BATCH_LIMIT = 500;

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  eventPayloadDays: 30,
  finishedJobDays: 30,
  idempotencyGraceDays: 7,
  scenarioRunDays: 30,
  auditLogDays: 2555,
};

const cutoff = (days: number) => sql`now() - make_interval(days => ${days}::int)`;

/** Each batch locks its rows with SKIP LOCKED so concurrent ticks prune disjoint rows. */
export async function pruneExpired(
  db: Db,
  policy: RetentionPolicy,
  limit = RETENTION_BATCH_LIMIT,
): Promise<PruneCounts> {
  const run = async (days: number, prune: () => Promise<{ id: string }[]>) =>
    days > 0 ? (await prune()).length : 0;

  return {
    eventPayloads: await run(policy.eventPayloadDays, () =>
      db.execute<{ id: string }>(sql`
        update provider_events set payload = '{}'::jsonb, payload_pruned_at = now()
        where id in (
          select id from provider_events
          where payload_pruned_at is null and status in ('processed', 'duplicate', 'ignored')
            and received_at < ${cutoff(policy.eventPayloadDays)}
          order by received_at limit ${limit} for update skip locked)
        returning id`),
    ),
    backgroundJobs: await run(policy.finishedJobDays, () =>
      db.transaction(async (tx) => {
        const batch = await tx.execute<{ id: string }>(sql`
          select id from background_jobs
          where status in ('succeeded', 'failed', 'dead')
            and updated_at < ${cutoff(policy.finishedJobDays)}
          order by updated_at limit ${limit} for update skip locked`);
        if (batch.length === 0) return [];
        const ids = sql.join(
          batch.map((j) => sql`${j.id}::uuid`),
          sql`, `,
        );
        await tx.execute(
          sql`update event_processing_attempts set job_id = null where job_id in (${ids})`,
        );
        return tx.execute<{ id: string }>(
          sql`delete from background_jobs where id in (${ids}) returning id`,
        );
      }),
    ),
    idempotencyRecords: await run(policy.idempotencyGraceDays, () =>
      db.execute<{ id: string }>(sql`
        delete from idempotency_records where id in (
          select id from idempotency_records where expires_at < ${cutoff(policy.idempotencyGraceDays)}
          order by expires_at limit ${limit} for update skip locked)
        returning id`),
    ),
    scenarioRuns: await run(policy.scenarioRunDays, () =>
      db.execute<{ id: string }>(sql`
        delete from demo_scenario_runs where id in (
          select id from demo_scenario_runs
          where status <> 'running' and started_at < ${cutoff(policy.scenarioRunDays)}
          order by started_at limit ${limit} for update skip locked)
        returning id`),
    ),
    auditLogs: await run(policy.auditLogDays, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.retention_prune', 'on', true)`);
        return tx.execute<{ id: string }>(sql`
          delete from audit_logs where id in (
            select id from audit_logs where created_at < ${cutoff(policy.auditLogDays)}
            order by created_at limit ${limit} for update skip locked)
          returning id`);
      }),
    ),
  };
}
