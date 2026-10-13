import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness, type TestUser } from '../test/identity-harness';
import { addCustomer } from '../test/reconciliation-fixtures';
import { addMemberWithRole, newTenant, type Tenant } from '../test/ops-harness';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';

function ingest(t: Tenant, user: TestUser, body: object, key: string | null = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/entitlements`,
    headers: { ...user.headers, ...(key ? { 'idempotency-key': key } : {}) },
    payload: body,
  });
}

const rowsOf = (t: Tenant) =>
  sql`select state, source, granted_at, revoked_at, version from entitlement_records where org_id = ${t.orgId}`;

const auditCount = async (t: Tenant) => {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from audit_logs
    where org_id = ${t.orgId} and action = 'entitlement.ingest' and outcome = 'success'`;
  return row?.n;
};

describe('entitlement ingestion', () => {
  it('lets an operator upsert an entitlement, discloses the source, and audits it', async () => {
    const t = await newTenant(harness, app);
    const operator = await addMemberWithRole(harness, app, t, 'OPERATOR');
    const customerId = await addCustomer(sql, t);
    const res = await ingest(t, operator, {
      customerId,
      entitlementKey: 'pro',
      state: 'active',
      observedAt: T1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      applied: true,
      entitlement: {
        entitlementKey: 'pro',
        state: 'active',
        source: 'ingestion_api',
        customer: { id: customerId },
        grantedAt: T1,
      },
    });
    expect(await auditCount(t)).toBe(1);
  });

  it('forbids viewers from writing', async () => {
    const t = await newTenant(harness, app);
    const viewer = await addMemberWithRole(harness, app, t, 'VIEWER');
    const customerId = await addCustomer(sql, t);
    const res = await ingest(t, viewer, {
      customerId,
      entitlementKey: 'pro',
      state: 'active',
      observedAt: T1,
    });
    expect(res.statusCode).toBe(403);
    expect(await rowsOf(t)).toHaveLength(0);
  });

  it('replays a retried key and rejects the key with a different body', async () => {
    const t = await newTenant(harness, app);
    const customerId = await addCustomer(sql, t);
    const body = { customerId, entitlementKey: 'pro', state: 'active', observedAt: T1 };
    const key = randomUUID();
    const first = await ingest(t, t.owner, body, key);
    const replay = await ingest(t, t.owner, body, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await auditCount(t)).toBe(1);
    const [row] = await rowsOf(t);
    expect(row?.version).toBe(0);
    const mismatch = await ingest(t, t.owner, { ...body, state: 'revoked' }, key);
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('requires an idempotency key', async () => {
    const t = await newTenant(harness, app);
    const customerId = await addCustomer(sql, t);
    const res = await ingest(
      t,
      t.owner,
      { customerId, entitlementKey: 'pro', state: 'active', observedAt: T1 },
      null,
    );
    expect(res.statusCode).toBe(400);
  });

  it('ignores a stale snapshot and applies a newer revocation', async () => {
    const t = await newTenant(harness, app);
    const customerId = await addCustomer(sql, t);
    const base = { customerId, entitlementKey: 'pro' };
    await ingest(t, t.owner, { ...base, state: 'revoked', observedAt: T2 });
    const stale = await ingest(t, t.owner, { ...base, state: 'active', observedAt: T1 });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ applied: false, entitlement: { state: 'revoked' } });
    const [row] = await rowsOf(t);
    expect(row).toMatchObject({ state: 'revoked', source: 'ingestion_api' });
    expect(new Date(String(row?.revoked_at)).toISOString()).toBe(T2);
  });

  it('lands on the newest snapshot when two writes race', async () => {
    const t = await newTenant(harness, app);
    const customerId = await addCustomer(sql, t);
    const base = { customerId, entitlementKey: 'pro' };
    const results = await Promise.all([
      ingest(t, t.owner, { ...base, state: 'active', observedAt: T1 }),
      ingest(t, t.owner, { ...base, state: 'expired', observedAt: T2 }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const rows = await rowsOf(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'expired' });
  });

  it('rejects a customer from another org without writing', async () => {
    const t = await newTenant(harness, app);
    const other = await newTenant(harness, app);
    const foreignCustomer = await addCustomer(sql, other);
    const res = await ingest(t, t.owner, {
      customerId: foreignCustomer,
      entitlementKey: 'pro',
      state: 'active',
      observedAt: T1,
    });
    expect(res.statusCode).toBe(404);
    expect(await rowsOf(t)).toHaveLength(0);
    expect(await rowsOf(other)).toHaveLength(0);
  });

  it('rejects an observedAt in the future', async () => {
    const t = await newTenant(harness, app);
    const customerId = await addCustomer(sql, t);
    const res = await ingest(t, t.owner, {
      customerId,
      entitlementKey: 'pro',
      state: 'active',
      observedAt: '2099-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(422);
    expect(await rowsOf(t)).toHaveLength(0);
  });
});
