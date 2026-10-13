import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { organizationsTable as o } from '../db/schema/identity';
import { providerConnectionsTable as c } from '../db/schema/providers';
import { reconciliationRunsTable as r } from '../db/schema/reconciliation';
import { RUN_RECONCILIATION_JOB_KIND } from '../jobs/handlers/run-reconciliation';
import { enqueueJob } from '../jobs/job-queue';

const SCHEDULER_LOCK_KEY = sql`hashtext('reconciliation_scheduler')`;

/** The xact advisory lock serializes concurrent ticks so the due check and the insert act as one. */
export async function scheduleDueRuns(db: Db, intervalHours: number): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SCHEDULER_LOCK_KEY})`);
    const created = await tx.execute<{ id: string; org_id: string }>(sql`
      insert into ${r} (org_id, mode, trigger, scope)
      select ${o.id}, 'local', 'scheduled', '{"connectionId":null}'::jsonb
      from ${o}
      where exists (select 1 from ${c} where ${c.orgId} = ${o.id} and ${c.status} = 'active')
        and not exists (
          select 1 from ${r}
          where ${r.orgId} = ${o.id}
            and (${r.status} = 'running' or ${r.startedAt} > now() - make_interval(hours => ${intervalHours}::int))
        )
      on conflict do nothing
      returning id, org_id`);
    for (const run of created) {
      await enqueueJob(tx, {
        kind: RUN_RECONCILIATION_JOB_KIND,
        payload: { runId: run.id },
        orgId: run.org_id,
        idempotencyKey: `run:${run.id}`,
      });
    }
    return created.length;
  });
}
