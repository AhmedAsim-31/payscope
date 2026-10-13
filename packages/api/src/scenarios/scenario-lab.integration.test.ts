import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SCENARIOS, type ScenarioRun } from '@payscope/shared/scenario-schemas';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import { createDefaultHandlers } from '../jobs/default-handlers';
import { createWorker } from '../jobs/worker';
import { DEFAULT_POLICIES } from '../rate-limit/policies';
import { registry, silent } from '../test/event-harness';
import { createHarness, TEST_CREDENTIALS_KEY } from '../test/identity-harness';
import { addMemberWithRole, newTenant, type Tenant } from '../test/ops-harness';
import { addCustomer, addPayment } from '../test/reconciliation-fixtures';
import { labConnectionId } from './lab-setup';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;
let owner: Tenant;
let other: Tenant;

const worker = createWorker({
  db: harness.db,
  handlers: createDefaultHandlers(registry, createCredentialsCipher(TEST_CREDENTIALS_KEY)),
  logger: silent,
  workerId: 'scenario-test',
});

beforeAll(async () => {
  app = await harness.start({
    rateLimits: { ...DEFAULT_POLICIES, scenarioRun: { max: 1000, windowSec: 600 } },
  });
  owner = await newTenant(harness, app);
  other = await newTenant(harness, app);
});
afterAll(() => harness.stop());

async function runScenario(t: Tenant, scenarioId: string): Promise<ScenarioRun> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/scenarios/${scenarioId}/run`,
    headers: t.owner.headers,
  });
  expect(res.statusCode).toBe(202);
  const { id } = res.json<ScenarioRun>();
  const [job] = await sql<{ id: string }[]>`
    select id from background_jobs where idempotency_key = ${`scenario-run:${id}`}`;
  await worker.drainOnce([job?.id ?? '']);
  const done = await app.inject({
    url: `/api/v1/orgs/${t.orgId}/scenario-runs/${id}`,
    headers: t.owner.headers,
  });
  return done.json<ScenarioRun>();
}

function failures(run: ScenarioRun): string {
  const failed = run.result?.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.detail})`);
  return JSON.stringify({ status: run.status, error: run.error, failed });
}

describe('scenario lab', () => {
  it.each(SCENARIOS.map((s) => [s.number, s.id] as const))(
    'scenario %i (%s) meets its expected outcome',
    async (_number, id) => {
      const run = await runScenario(owner, id);
      expect(run.status, failures(run)).toBe('passed');
      expect(run.result?.checks.length).toBeGreaterThan(0);
    },
  );

  it('is repeatable: running a scenario again passes with fresh evidence', async () => {
    const first = await runScenario(owner, 'duplicate-webhook');
    const second = await runScenario(owner, 'duplicate-webhook');
    expect(second.status, failures(second)).toBe('passed');
    expect(second.result?.evidence.eventIds[0]).not.toBe(first.result?.evidence.eventIds[0]);
  });

  it('records http evidence for the route-driven scenarios', async () => {
    const run = await runScenario(owner, 'invalid-signature');
    expect(run.result?.evidence.http).toEqual([
      expect.objectContaining({ status: 400, code: 'WEBHOOK_SIGNATURE_INVALID' }),
    ]);
  });

  it('lists the catalog with the last run of each scenario', async () => {
    const res = await app.inject({
      url: `/api/v1/orgs/${owner.orgId}/scenarios`,
      headers: owner.owner.headers,
    });
    const { data } = res.json<{ data: { id: string; lastRun: ScenarioRun | null }[] }>();
    expect(data).toHaveLength(17);
    expect(data.every((s) => s.lastRun?.status === 'passed')).toBe(true);
  });

  it('keeps runs private to their organization', async () => {
    const run = await runScenario(owner, 'successful-payment');
    const foreign = await app.inject({
      url: `/api/v1/orgs/${other.orgId}/scenario-runs/${run.id}`,
      headers: other.owner.headers,
    });
    expect(foreign.statusCode).toBe(404);
    const catalog = await app.inject({
      url: `/api/v1/orgs/${other.orgId}/scenarios`,
      headers: other.owner.headers,
    });
    expect(
      catalog.json<{ data: { lastRun: unknown }[] }>().data.every((s) => s.lastRun === null),
    ).toBe(true);
  });

  it('forbids a viewer from running or resetting', async () => {
    const viewer = await addMemberWithRole(harness, app, owner, 'VIEWER');
    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${owner.orgId}/scenarios/successful-payment/run`,
      headers: viewer.headers,
    });
    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${owner.orgId}/scenarios/reset`,
      headers: viewer.headers,
    });
    const read = await app.inject({
      url: `/api/v1/orgs/${owner.orgId}/scenarios`,
      headers: viewer.headers,
    });
    expect([run.statusCode, reset.statusCode, read.statusCode]).toEqual([403, 403, 200]);
  });

  it('audits runs', async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_logs where org_id = ${owner.orgId} and action = 'scenario.run'`;
    expect(row?.n).toBeGreaterThanOrEqual(17);
  });

  it('reset removes only this organization scenario-lab data', async () => {
    const customer = await addCustomer(sql, owner);
    await addPayment(sql, owner, { customerId: customer });
    await runScenario(other, 'successful-payment');
    const count = (table: string, where: string, id: string) =>
      sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${table} where ${where} = '${id}'`,
      );
    const lab = labConnectionId(owner.orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${owner.orgId}/scenarios/reset`,
      headers: owner.owner.headers,
    });
    expect(res.statusCode).toBe(200);
    expect((await count('provider_events', 'connection_id', lab))[0]?.n).toBe(0);
    expect((await count('payment_records', 'connection_id', lab))[0]?.n).toBe(0);
    expect((await count('provider_connections', 'id', lab))[0]?.n).toBe(0);
    expect((await count('demo_scenario_runs', 'org_id', owner.orgId))[0]?.n).toBe(0);
    expect((await count('payment_records', 'connection_id', owner.connectionId))[0]?.n).toBe(1);
    expect(
      (await count('payment_records', 'connection_id', labConnectionId(other.orgId)))[0]?.n,
    ).toBe(1);
    expect((await count('demo_scenario_runs', 'org_id', other.orgId))[0]?.n).toBe(1);

    const again = await runScenario(owner, 'successful-payment');
    expect(again.status, failures(again)).toBe('passed');
  });
});
