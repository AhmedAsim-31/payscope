import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import { createRunReconciliationHandler } from '../jobs/handlers/run-reconciliation';
import { registry, silent } from '../test/event-harness';
import { createHarness, TEST_CREDENTIALS_KEY, type TestUser } from '../test/identity-harness';
import {
  addCustomer,
  addEntitlement,
  addPayment,
  addStuckEvent,
  addSubscription,
  reconJob,
  seedConnection,
  type Org,
} from '../test/reconciliation-fixtures';

const harness = createHarness();
const { sql, db } = harness;
let app: FastifyInstance;
const handler = createRunReconciliationHandler(
  registry,
  createCredentialsCipher(TEST_CREDENTIALS_KEY),
  { batchSize: 2 },
);

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

type Tenant = Org & { owner: TestUser };
type FindingView = { id: string; type: string; subjectId: string; status: string };
type RunView = { id: string; status: string; counts: Record<string, number>; error: string | null };

async function newTenant(): Promise<Tenant> {
  const owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Recon', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const org = await seedConnection(sql, res.json<{ id: string }>().id, false);
  return { ...org, owner };
}

const url = (t: Tenant, path: string) => `/api/v1/orgs/${t.orgId}/reconciliation/${path}`;

async function startRun(t: Tenant, user = t.owner, body: object = { mode: 'local' }) {
  return app.inject({ method: 'POST', url: url(t, 'runs'), headers: user.headers, payload: body });
}

async function runLocal(t: Tenant): Promise<RunView> {
  const res = await startRun(t);
  expect(res.statusCode).toBe(202);
  const runId = res.json<{ id: string }>().id;
  await handler(reconJob(t.orgId, runId), { db, logger: silent, workerId: 'test' });
  const run = await app.inject({ url: url(t, `runs/${runId}`), headers: t.owner.headers });
  return run.json<RunView>();
}

async function findings(t: Tenant, query = ''): Promise<FindingView[]> {
  const res = await app.inject({
    url: url(t, `findings?limit=100${query}`),
    headers: t.owner.headers,
  });
  return res.json<{ items: FindingView[] }>().items;
}

const subjectsOf = (list: FindingView[], type: string) =>
  list.filter((f) => f.type === type).map((f) => f.subjectId);

describe('local reconciliation rules', () => {
  it('detects each seeded inconsistency and ignores consistent control rows', async () => {
    const t = await newTenant();
    const past = '2020-01-01T00:00:00Z';
    const future = '2099-01-01T00:00:00Z';

    const badA = await addCustomer(sql, t);
    await addPayment(sql, t, { customerId: badA });
    await addSubscription(sql, t, badA, 'active', future);
    const okA = await addCustomer(sql, t);
    await addPayment(sql, t, { customerId: okA });
    const okSub = await addSubscription(sql, t, okA, 'active', future);
    await addEntitlement(sql, t, okA, 'active', okSub);

    const customerB = await addCustomer(sql, t);
    const expiredSub = await addSubscription(sql, t, customerB, 'expired', past);
    await addEntitlement(sql, t, customerB, 'active', expiredSub);
    const customerC = await addCustomer(sql, t);
    const okExpired = await addSubscription(sql, t, customerC, 'expired', past);
    await addEntitlement(sql, t, customerC, 'expired', okExpired);

    const refundBad1 = await addPayment(sql, t, { status: 'succeeded', refunded: 500 });
    const refundBad2 = await addPayment(sql, t, { status: 'refunded', refunded: 0 });
    const refundOk = await addPayment(sql, t, { status: 'partially_refunded', refunded: 500 });

    const unmapped = await addCustomer(sql, t, 0);
    const ambiguous = await addCustomer(sql, t, 2);
    const mappedPay = await addPayment(sql, t, { customerId: unmapped });
    const ambiguousPay = await addPayment(sql, t, { customerId: ambiguous });

    const stuck = await addPayment(sql, t, { status: 'pending' });
    await addStuckEvent(sql, t, stuck.providerId, 'payment.succeeded');
    const agrees = await addPayment(sql, t, { status: 'succeeded' });
    await addStuckEvent(sql, t, agrees.providerId, 'payment.succeeded');
    const processed = await addPayment(sql, t, { status: 'pending' });
    await addStuckEvent(sql, t, processed.providerId, 'payment.succeeded', 'processed');

    const run = await runLocal(t);
    expect(run.status).toBe('completed');
    const list = await findings(t);

    expect(subjectsOf(list, 'entitlement_missing_or_stale')).toEqual([badA]);
    expect(subjectsOf(list, 'expired_externally_active_locally')).toEqual([expiredSub]);
    expect(subjectsOf(list, 'refund_inconsistent').sort()).toEqual(
      [refundBad1.id, refundBad2.id].sort(),
    );
    expect(subjectsOf(list, 'refund_inconsistent')).not.toContain(refundOk.id);
    expect(subjectsOf(list, 'mapping_missing_or_ambiguous').sort()).toEqual(
      [mappedPay.id, ambiguousPay.id].sort(),
    );
    expect(subjectsOf(list, 'status_mismatch')).toEqual([stuck.id]);
    expect(list).toHaveLength(7);
    expect(run.counts).toMatchObject({ examined: 7, mismatched: 7 });
  });

  it('re-running updates last_seen instead of duplicating findings', async () => {
    const t = await newTenant();
    await addPayment(sql, t, { status: 'succeeded', refunded: 100 });
    const first = await runLocal(t);
    const second = await runLocal(t);
    const list = await findings(t);
    expect(list).toHaveLength(1);
    const detail = await app.inject({
      url: url(t, `findings/${list[0]?.id}`),
      headers: t.owner.headers,
    });
    expect(detail.json()).toMatchObject({
      firstSeenRunId: first.id,
      lastSeenRunId: second.id,
      status: 'open',
    });
  });

  it('returns 409 for a second concurrent run request', async () => {
    const t = await newTenant();
    const results = await Promise.all([startRun(t), startRun(t)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([202, 409]);
    const loser = results.find((r) => r.statusCode === 409);
    expect(loser?.json()).toMatchObject({ error: { code: 'RUN_IN_PROGRESS' } });
    const [job] = await sql<{ idempotency_key: string }[]>`
      select idempotency_key from background_jobs where org_id = ${t.orgId}`;
    expect(job?.idempotency_key).toMatch(/^run:/);
  });
});

describe('reconciliation API', () => {
  it('isolates runs and findings across orgs', async () => {
    const a = await newTenant();
    const b = await newTenant();
    await addPayment(sql, a, { status: 'succeeded', refunded: 100 });
    const run = await runLocal(a);
    const [finding] = await findings(a);
    const asB = { headers: b.owner.headers };
    const cross = [
      await app.inject({ url: url(a, 'findings'), ...asB }),
      await app.inject({ url: url(b, `findings/${finding?.id}`), ...asB }),
      await app.inject({ url: url(b, `runs/${run.id}`), ...asB }),
    ];
    expect(cross.map((r) => r.statusCode)).toEqual([404, 404, 404]);
    expect(await findings(b)).toEqual([]);
  });

  it('forbids a VIEWER from starting a run', async () => {
    const t = await newTenant();
    const viewer = await harness.newUser();
    await app.inject({ url: '/api/v1/orgs', headers: viewer.headers });
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${t.orgId}/members`,
      headers: t.owner.headers,
      payload: { email: viewer.email, role: 'VIEWER' },
    });
    expect((await startRun(t, viewer)).statusCode).toBe(403);
    const read = await app.inject({ url: url(t, 'runs'), headers: viewer.headers });
    expect(read.statusCode).toBe(200);
  });

  it('triages findings with a conditional update and rejects resolved', async () => {
    const t = await newTenant();
    await addPayment(sql, t, { status: 'succeeded', refunded: 100 });
    await runLocal(t);
    const [finding] = await findings(t);
    const patch = (payload: object) =>
      app.inject({
        method: 'PATCH',
        url: url(t, `findings/${finding?.id}`),
        headers: t.owner.headers,
        payload,
      });
    expect((await patch({ status: 'resolved', note: 'x' })).statusCode).toBe(400);
    expect((await patch({ status: 'reviewed', note: 'looking' })).json()).toMatchObject({
      status: 'reviewed',
      resolutionNote: 'looking',
    });
    expect((await patch({ status: 'dismissed', note: 'noise' })).statusCode).toBe(200);
    expect((await patch({ status: 'reviewed', note: 'again' })).statusCode).toBe(409);
    expect(
      await findings(t, '&status=dismissed&type=refund_inconsistent&severity=medium'),
    ).toHaveLength(1);
  });

  it('rejects provider mode without a connection or credentials', async () => {
    const t = await newTenant();
    const noConnection = await startRun(t, t.owner, { mode: 'provider' });
    expect(noConnection.statusCode).toBe(400);
    const noCredentials = await startRun(t, t.owner, {
      mode: 'provider',
      connectionId: t.connectionId,
    });
    expect(noCredentials.statusCode).toBe(422);
  });
});
