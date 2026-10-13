import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAdapterRegistry } from '@payscope/provider-adapters/registry';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import {
  createRunReconciliationHandler,
  RUN_RECONCILIATION_JOB_KIND,
} from '../jobs/handlers/run-reconciliation';
import type { ExecutorOptions } from './run-executor';
import { silent } from '../test/event-harness';
import { createHarness, TEST_CREDENTIALS_KEY, type TestUser } from '../test/identity-harness';
import {
  addPayment,
  createFakeAdapter,
  reconJob,
  seedConnection,
  type FakeBehavior,
  type Org,
} from '../test/reconciliation-fixtures';

const harness = createHarness();
const { sql, db } = harness;
let app: FastifyInstance;
let owner: TestUser;
let current: ReturnType<typeof createFakeAdapter>;
const behaviors = new Map<string, FakeBehavior>();
const registry = createAdapterRegistry([
  {
    ...createFakeAdapter(new Map()).adapter,
    fetchPayment: (ctx, id) =>
      current.adapter.fetchPayment?.(ctx, id) ?? Promise.reject(new Error('unset')),
    fetchSubscription: (ctx, id) =>
      current.adapter.fetchSubscription?.(ctx, id) ?? Promise.reject(new Error('unset')),
  },
]);

type RunView = { id: string; status: string; counts: Record<string, number>; error: string | null };
type FindingView = { type: string; subjectId: string; severity: string };

beforeAll(async () => {
  app = await harness.start({ adapters: registry });
  owner = await harness.newUser();
});
afterAll(() => harness.stop());

async function newOrg(): Promise<Org> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Prov', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  return seedConnection(sql, res.json<{ id: string }>().id);
}

function useFake(onCall?: (id: string) => Promise<void> | void) {
  behaviors.clear();
  current = createFakeAdapter(behaviors, onCall);
  return current;
}

async function startProviderRun(o: Org): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${o.orgId}/reconciliation/runs`,
    headers: owner.headers,
    payload: { mode: 'provider', connectionId: o.connectionId },
  });
  expect(res.statusCode).toBe(202);
  return res.json<{ id: string }>().id;
}

function execute(o: Org, runId: string, options: Partial<ExecutorOptions> = {}) {
  const handler = createRunReconciliationHandler(
    registry,
    createCredentialsCipher(TEST_CREDENTIALS_KEY),
    options,
  );
  return handler(reconJob(o.orgId, runId), { db, logger: silent, workerId: 'test' });
}

async function getRun(o: Org, runId: string): Promise<RunView> {
  const res = await app.inject({
    url: `/api/v1/orgs/${o.orgId}/reconciliation/runs/${runId}`,
    headers: owner.headers,
  });
  return res.json<RunView>();
}

async function findings(o: Org): Promise<FindingView[]> {
  const res = await app.inject({
    url: `/api/v1/orgs/${o.orgId}/reconciliation/findings`,
    headers: owner.headers,
  });
  return res.json<{ items: FindingView[] }>().items;
}

describe('provider-mode reconciliation', () => {
  it('classifies not_found and unavailable differently and never calls unavailable missing', async () => {
    const fake = useFake();
    const o = await newOrg();
    const same = await addPayment(sql, o, { status: 'succeeded' });
    const differs = await addPayment(sql, o, { status: 'pending' });
    const gone = await addPayment(sql, o, {});
    const down = await addPayment(sql, o, {});
    behaviors.set(same.providerId, { kind: 'ok', status: 'succeeded', amountMinor: 1000n });
    behaviors.set(differs.providerId, { kind: 'ok', status: 'succeeded' });
    behaviors.set(down.providerId, { kind: 'error', category: 'unavailable' });

    const runId = await startProviderRun(o);
    await execute(o, runId);

    const run = await getRun(o, runId);
    expect(run.status).toBe('partial');
    expect(run.counts).toMatchObject({ examined: 4, matched: 1, mismatched: 2, unavailable: 1 });
    const list = await findings(o);
    const byType = (t: string) => list.filter((f) => f.type === t);
    expect(byType('status_mismatch').map((f) => f.subjectId)).toEqual([differs.id]);
    expect(byType('provider_object_not_found').map((f) => f.subjectId)).toEqual([gone.id]);
    expect(byType('provider_unavailable').map((f) => [f.subjectId, f.severity])).toEqual([
      [down.id, 'low'],
    ]);
    expect(fake.calls).toHaveLength(4);
  });

  it('stops at the per-run request cap and records a partial run', async () => {
    const fake = useFake();
    const o = await newOrg();
    for (let i = 0; i < 5; i++) await addPayment(sql, o, {});
    const runId = await startProviderRun(o);
    await execute(o, runId, { requestCap: 2, batchSize: 10 });
    expect(fake.calls).toHaveLength(2);
    expect(await getRun(o, runId)).toMatchObject({
      status: 'partial',
      error: 'request_cap_reached',
    });
  });

  it('marks the run partial with an error on provider_auth', async () => {
    useFake();
    const o = await newOrg();
    const p = await addPayment(sql, o, {});
    behaviors.set(p.providerId, { kind: 'error', category: 'provider_auth' });
    const runId = await startProviderRun(o);
    await execute(o, runId);
    expect(await getRun(o, runId)).toMatchObject({
      status: 'partial',
      error: 'provider_auth_failed',
    });
  });

  it('resumes from the checkpoint after a crash and only processes remaining rows', async () => {
    const fake = useFake();
    const o = await newOrg();
    for (let i = 0; i < 5; i++) {
      const p = await addPayment(sql, o, { status: 'succeeded' });
      behaviors.set(p.providerId, { kind: 'ok', status: 'succeeded' });
    }
    const runId = await startProviderRun(o);
    await expect(
      execute(o, runId, {
        batchSize: 2,
        onBatchCommitted: () => {
          throw new Error('simulated crash');
        },
      }),
    ).rejects.toThrow('simulated crash');
    expect(fake.calls).toHaveLength(2);
    expect((await getRun(o, runId)).status).toBe('running');

    await execute(o, runId, { batchSize: 2 });
    const run = await getRun(o, runId);
    expect(fake.calls).toHaveLength(5);
    expect(new Set(fake.calls).size).toBe(5);
    expect(run).toMatchObject({ status: 'completed' });
    expect(run.counts).toMatchObject({ examined: 5, matched: 5 });
  });

  it('never calls the provider while a database transaction is open', async () => {
    const openTransactions: number[] = [];
    useFake(async () => {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and state like 'idle in transaction%'`;
      openTransactions.push(row?.n ?? -1);
    });
    const o = await newOrg();
    for (let i = 0; i < 3; i++) await addPayment(sql, o, {});
    const runId = await startProviderRun(o);
    await execute(o, runId, { batchSize: 2 });
    expect(openTransactions).toHaveLength(3);
    expect(openTransactions.every((n) => n === 0)).toBe(true);
  });

  it('enqueues the run job under the run idempotency key', async () => {
    useFake();
    const o = await newOrg();
    const runId = await startProviderRun(o);
    const [job] = await sql<{ kind: string }[]>`
      select kind from background_jobs where idempotency_key = ${`run:${runId}`}`;
    expect(job?.kind).toBe(RUN_RECONCILIATION_JOB_KIND);
  });
});
