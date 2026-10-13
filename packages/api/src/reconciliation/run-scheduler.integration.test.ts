import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createHarness } from '../test/identity-harness';
import { seedConnection } from '../test/reconciliation-fixtures';
import { scheduleDueRuns } from './run-scheduler';

const harness = createHarness();
afterAll(() => harness.stop());

async function newOrg(): Promise<string> {
  const [row] = await harness.sql<{ id: string }[]>`
    insert into organizations (name, slug) values ('Sched', ${`org-${randomUUID().slice(0, 12)}`})
    returning id`;
  if (!row) throw new Error('org insert failed');
  return row.id;
}

function runsFor(orgId: string) {
  return harness.sql<{ id: string; trigger: string; mode: string; job_status: string | null }[]>`
    select r.id, r.trigger, r.mode,
           (select j.status::text from background_jobs j where j.idempotency_key = 'run:' || r.id::text) as job_status
    from reconciliation_runs r where r.org_id = ${orgId}`;
}

describe('scheduleDueRuns', () => {
  it('starts one scheduled local run with a queued job for an org with an active connection', async () => {
    const orgId = await newOrg();
    await seedConnection(harness.sql, orgId);

    await scheduleDueRuns(harness.db, 24);
    await scheduleDueRuns(harness.db, 24);

    const runs = await runsFor(orgId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'scheduled', mode: 'local', job_status: 'queued' });
  });

  it('skips orgs without an active connection', async () => {
    const orgId = await newOrg();
    const { connectionId } = await seedConnection(harness.sql, orgId);
    await harness.sql`update provider_connections set status = 'disabled' where id = ${connectionId}`;

    await scheduleDueRuns(harness.db, 24);

    expect(await runsFor(orgId)).toHaveLength(0);
  });

  it('waits for the interval since the last run of any trigger', async () => {
    const orgId = await newOrg();
    await seedConnection(harness.sql, orgId);
    await harness.sql`insert into reconciliation_runs (org_id, mode, status, started_at, finished_at)
      values (${orgId}, 'local', 'completed', now() - interval '23 hours', now() - interval '23 hours')`;

    await scheduleDueRuns(harness.db, 24);
    expect(await runsFor(orgId)).toHaveLength(1);

    await harness.sql`update reconciliation_runs set started_at = now() - interval '25 hours' where org_id = ${orgId}`;
    await scheduleDueRuns(harness.db, 24);
    const runs = await runsFor(orgId);
    expect(runs.map((r) => r.trigger).sort()).toEqual(['manual', 'scheduled']);
  });

  it('creates a single run under concurrent ticks', async () => {
    const orgId = await newOrg();
    await seedConnection(harness.sql, orgId);

    await Promise.all(Array.from({ length: 5 }, () => scheduleDueRuns(harness.db, 24)));

    expect(await runsFor(orgId)).toHaveLength(1);
  });
});
