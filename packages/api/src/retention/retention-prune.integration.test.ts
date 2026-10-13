import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness } from '../test/identity-harness';
import { seedConnection, type Org } from '../test/reconciliation-fixtures';
import { pruneExpired, type RetentionPolicy } from './retention-prune';

const harness = createHarness();
const OLD = '1990-01-01T00:00:00Z';
const policy: RetentionPolicy = {
  eventPayloadDays: 30,
  finishedJobDays: 30,
  idempotencyGraceDays: 7,
  scenarioRunDays: 30,
  auditLogDays: 2555,
};
let org: Org;

beforeAll(async () => {
  const [row] = await harness.sql<{ id: string }[]>`
    insert into organizations (name, slug) values ('Retention', ${`org-${randomUUID().slice(0, 12)}`})
    returning id`;
  org = await seedConnection(harness.sql, row?.id ?? '');
});
afterAll(() => harness.stop());

async function addEvent(status: string, receivedAt: string) {
  const [row] = await harness.sql<{ id: string }[]>`
    insert into provider_events (org_id, connection_id, provider, provider_event_id, event_type,
      occurred_at, received_at, status, signature_verified, payload)
    values (${org.orgId}, ${org.connectionId}, 'stripe', ${`evt_${randomUUID()}`}, 'charge.succeeded',
      ${receivedAt}, ${receivedAt}, ${status}, true, '{"data":{"email":"a@b.test"}}'::jsonb)
    returning id`;
  return row?.id ?? '';
}

async function addJob(status: string, updatedAt: string) {
  const [row] = await harness.sql<{ id: string }[]>`
    insert into background_jobs (org_id, kind, status, updated_at)
    values (${org.orgId}, 'test', ${status}, ${updatedAt}) returning id`;
  return row?.id ?? '';
}

async function addIdempotency(expiresAt: string) {
  const [row] = await harness.sql<{ id: string }[]>`
    insert into idempotency_records (org_id, scope, key, request_hash, expires_at)
    values (${org.orgId}, 'test', ${randomUUID()}, 'h', ${expiresAt}) returning id`;
  return row?.id ?? '';
}

async function addScenarioRun(status: string, startedAt: string) {
  const [row] = await harness.sql<{ id: string }[]>`
    insert into demo_scenario_runs (org_id, scenario_id, status, started_at)
    values (${org.orgId}, 'test', ${status}, ${startedAt}) returning id`;
  return row?.id ?? '';
}

async function addAudit(createdAt: string) {
  const [row] = await harness.sql<{ id: string }[]>`
    insert into audit_logs (org_id, actor_type, action, target_type, outcome, created_at)
    values (${org.orgId}, 'system', 'test.retention', 'test', 'success', ${createdAt}) returning id`;
  return row?.id ?? '';
}

async function exists(table: string, id: string) {
  const [row] = await harness.sql<{ n: number }[]>`
    select count(*)::int as n from ${harness.sql(table)} where id = ${id}`;
  return row?.n === 1;
}

function eventPayload(id: string) {
  return harness.sql<{ payload: unknown; payload_pruned_at: string | null; status: string }[]>`
    select payload, payload_pruned_at, status from provider_events where id = ${id}`;
}

describe('pruneExpired', () => {
  it('redacts old terminal event payloads but keeps the event row and in-flight payloads', async () => {
    const old = await addEvent('processed', OLD);
    const failed = await addEvent('failed', OLD);
    const recent = await addEvent('processed', new Date().toISOString());

    await pruneExpired(harness.db, policy);

    const [pruned] = await eventPayload(old);
    expect(pruned).toMatchObject({ payload: {}, status: 'processed' });
    expect(pruned?.payload_pruned_at).not.toBeNull();
    expect((await eventPayload(failed))[0]?.payload_pruned_at).toBeNull();
    expect((await eventPayload(recent))[0]?.payload_pruned_at).toBeNull();
  });

  it('deletes old finished jobs, detaching their attempts, and keeps queued or recent ones', async () => {
    const event = await addEvent('processed', OLD);
    const done = await addJob('succeeded', OLD);
    const dead = await addJob('dead', OLD);
    const queued = await addJob('queued', OLD);
    const recent = await addJob('succeeded', new Date().toISOString());
    await harness.sql`insert into event_processing_attempts (org_id, event_id, job_id, attempt_number)
      values (${org.orgId}, ${event}, ${done}, 1)`;

    await pruneExpired(harness.db, policy);

    expect(await exists('background_jobs', done)).toBe(false);
    expect(await exists('background_jobs', dead)).toBe(false);
    expect(await exists('background_jobs', queued)).toBe(true);
    expect(await exists('background_jobs', recent)).toBe(true);
    const attempts = await harness.sql<{ job_id: string | null }[]>`
      select job_id from event_processing_attempts where event_id = ${event}`;
    expect(attempts).toEqual([{ job_id: null }]);
  });

  it('deletes idempotency records past expiry plus grace, scenario runs and audit logs past their period', async () => {
    const expired = await addIdempotency(OLD);
    const live = await addIdempotency(new Date(Date.now() - 86_400_000).toISOString());
    const oldRun = await addScenarioRun('passed', OLD);
    const runningRun = await addScenarioRun('running', OLD);
    const recentRun = await addScenarioRun('failed', new Date().toISOString());
    const oldAudit = await addAudit(OLD);
    const recentAudit = await addAudit(new Date(Date.now() - 365 * 86_400_000).toISOString());

    const counts = await pruneExpired(harness.db, policy);

    expect(counts.idempotencyRecords).toBeGreaterThanOrEqual(1);
    expect(await exists('idempotency_records', expired)).toBe(false);
    expect(await exists('idempotency_records', live)).toBe(true);
    expect(await exists('demo_scenario_runs', oldRun)).toBe(false);
    expect(await exists('demo_scenario_runs', runningRun)).toBe(true);
    expect(await exists('demo_scenario_runs', recentRun)).toBe(true);
    expect(await exists('audit_logs', oldAudit)).toBe(false);
    expect(await exists('audit_logs', recentAudit)).toBe(true);
  });

  it('keeps audit logs append-only outside the prune', async () => {
    const id = await addAudit(OLD);
    await expect(harness.sql`delete from audit_logs where id = ${id}`).rejects.toThrow(
      /append-only/,
    );
  });

  it('never touches payment or incident rows however old', async () => {
    const [payment] = await harness.sql<{ id: string }[]>`
      insert into payment_records (org_id, connection_id, provider_payment_id, status, amount_minor,
        currency, created_at, updated_at)
      values (${org.orgId}, ${org.connectionId}, ${`pi_${randomUUID()}`}, 'succeeded', 100, 'USD', ${OLD}, ${OLD})
      returning id`;
    const [incident] = await harness.sql<{ id: string }[]>`
      insert into incidents (org_id, category, severity, status, title, fingerprint, opened_at, last_seen_at, resolved_at)
      values (${org.orgId}, 'test', 'low', 'resolved', 'Old', ${randomUUID()}, ${OLD}, ${OLD}, ${OLD})
      returning id`;

    await pruneExpired(harness.db, policy);

    expect(await exists('payment_records', payment?.id ?? '')).toBe(true);
    expect(await exists('incidents', incident?.id ?? '')).toBe(true);
  });

  it('prunes at most the batch limit per table per call, oldest first', async () => {
    const ids = [
      await addJob('succeeded', '1980-01-01T00:00:00Z'),
      await addJob('succeeded', '1980-01-02T00:00:00Z'),
      await addJob('succeeded', '1980-01-03T00:00:00Z'),
    ];

    const counts = await pruneExpired(harness.db, policy, 2);

    expect(counts.backgroundJobs).toBe(2);
    expect(await Promise.all(ids.map((id) => exists('background_jobs', id)))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('keeps everything when a period is 0', async () => {
    const event = await addEvent('processed', OLD);
    const job = await addJob('succeeded', OLD);
    const idem = await addIdempotency(OLD);
    const run = await addScenarioRun('passed', OLD);
    const audit = await addAudit(OLD);

    const counts = await pruneExpired(harness.db, {
      eventPayloadDays: 0,
      finishedJobDays: 0,
      idempotencyGraceDays: 0,
      scenarioRunDays: 0,
      auditLogDays: 0,
    });

    expect(counts).toEqual({
      eventPayloads: 0,
      backgroundJobs: 0,
      idempotencyRecords: 0,
      scenarioRuns: 0,
      auditLogs: 0,
    });
    expect((await eventPayload(event))[0]?.payload_pruned_at).toBeNull();
    for (const [table, id] of [
      ['background_jobs', job],
      ['idempotency_records', idem],
      ['demo_scenario_runs', run],
      ['audit_logs', audit],
    ] as const) {
      expect(await exists(table, id)).toBe(true);
    }
  });

  it('splits rows between concurrent prunes without double counting', async () => {
    for (let i = 0; i < 6; i++) await addJob('dead', '1970-01-02T00:00:00Z');

    const [a, b] = await Promise.all([
      pruneExpired(harness.db, policy, 3),
      pruneExpired(harness.db, policy, 3),
    ]);

    expect(a.backgroundJobs + b.backgroundJobs).toBeLessThanOrEqual(6);
    const [left] = await harness.sql<{ n: number }[]>`
      select count(*)::int as n from background_jobs where updated_at = '1970-01-02T00:00:00Z'`;
    expect(left?.n).toBe(6 - a.backgroundJobs - b.backgroundJobs);
  });
});
