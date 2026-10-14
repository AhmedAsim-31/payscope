import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness } from '../test/identity-harness';
import {
  addMemberWithRole,
  newTenant,
  REASON,
  runLocalRecon,
  type Tenant,
} from '../test/ops-harness';
import { addCustomer, addEntitlement, addSubscription } from '../test/reconciliation-fixtures';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

async function addStaleEntitlement(t: Tenant) {
  const customer = await addCustomer(sql, t);
  const subId = await addSubscription(sql, t, customer, 'expired', '2020-01-01T00:00:00Z');
  await addEntitlement(sql, t, customer, 'active', subId);
}

const incidents = async (t: Tenant) =>
  sql<{ id: string; finding_count: number; status: string }[]>`
    select id, finding_count, status from incidents where org_id = ${t.orgId}`;

function act(t: Tenant, id: string, action: string, user = t.owner) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/incidents/${id}/actions`,
    headers: user.headers,
    payload: { action, note: REASON },
  });
}

describe('incidents', () => {
  it('deduplicates by fingerprint across runs and refreshes the count', async () => {
    const t = await newTenant(harness, app);
    await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    await runLocalRecon(harness, app, t);
    expect(await incidents(t)).toHaveLength(1);
    await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    const rows = await incidents(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.finding_count).toBe(2);
  });

  it('supports acknowledge, note, resolve with audit and a fresh incident after resolve', async () => {
    const t = await newTenant(harness, app);
    await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    const [incident] = await incidents(t);
    const id = incident?.id ?? '';
    expect((await act(t, id, 'acknowledge')).statusCode).toBe(200);
    expect((await act(t, id, 'acknowledge')).statusCode).toBe(409);
    expect((await act(t, id, 'note')).statusCode).toBe(200);
    const detail = await app.inject({
      url: `/api/v1/orgs/${t.orgId}/incidents/${id}`,
      headers: t.owner.headers,
    });
    expect(detail.json<{ status: string; actions: unknown[] }>()).toMatchObject({
      status: 'investigating',
    });
    expect(detail.json<{ actions: unknown[] }>().actions).toHaveLength(2);
    expect((await act(t, id, 'resolve')).statusCode).toBe(200);
    const [audits] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_logs where org_id = ${t.orgId} and action like 'incident.%'`;
    expect(audits?.n).toBeGreaterThanOrEqual(4);
    await runLocalRecon(harness, app, t);
    expect(await incidents(t)).toHaveLength(2);
  });

  it('filters the list by severity and category', async () => {
    const t = await newTenant(harness, app);
    await sql`
      insert into incidents (org_id, category, severity, title, fingerprint) values
        (${t.orgId}, 'status_mismatch', 'high', 'a', 'f:a'),
        (${t.orgId}, 'status_mismatch', 'critical', 'b', 'f:b'),
        (${t.orgId}, 'refund_inconsistent', 'critical', 'c', 'f:c')`;
    const list = (query: string) =>
      app.inject({
        url: `/api/v1/orgs/${t.orgId}/incidents?${query}`,
        headers: t.owner.headers,
      });
    const titles = async (query: string) =>
      (await list(query))
        .json<{ items: { title: string }[] }>()
        .items.map((x) => x.title)
        .sort();
    expect(await titles('severity=critical')).toEqual(['b', 'c']);
    expect(await titles('category=status_mismatch')).toEqual(['a', 'b']);
    expect(await titles('severity=critical&category=status_mismatch')).toEqual(['b']);
    expect((await list('category=nope')).statusCode).toBe(400);
    expect((await list('severity=nope')).statusCode).toBe(400);
  });

  it('lets a viewer read but not act, and hides other orgs', async () => {
    const t = await newTenant(harness, app);
    const other = await newTenant(harness, app);
    await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    const id = (await incidents(t))[0]?.id ?? '';
    const viewer = await addMemberWithRole(harness, app, t, 'VIEWER');
    const list = await app.inject({
      url: `/api/v1/orgs/${t.orgId}/incidents`,
      headers: viewer.headers,
    });
    expect(list.statusCode).toBe(200);
    expect((await act(t, id, 'acknowledge', viewer)).statusCode).toBe(403);
    const foreign = await app.inject({
      url: `/api/v1/orgs/${other.orgId}/incidents/${id}`,
      headers: other.owner.headers,
    });
    expect(foreign.statusCode).toBe(404);
  });
});
