import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness } from '../test/identity-harness';
import { newTenant, REASON, repairCall, runLocalRecon, type Tenant } from '../test/ops-harness';
import { addCustomer, addEntitlement, addSubscription } from '../test/reconciliation-fixtures';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

const TYPE = 'expired_externally_active_locally';

async function addStaleEntitlement(t: Tenant) {
  const customer = await addCustomer(sql, t);
  const subId = await addSubscription(sql, t, customer, 'expired', '2020-01-01T00:00:00Z');
  return addEntitlement(sql, t, customer, 'active', subId);
}

const findingIds = async (t: Tenant) =>
  (
    await sql<{ id: string }[]>`
      select id from reconciliation_findings where org_id = ${t.orgId} and type = ${TYPE}::finding_type
      order by created_at`
  ).map((r) => r.id);

const incident = async (t: Tenant) => {
  const [row] = await sql<
    { id: string; finding_count: number; status: string; resolved_at: Date | null }[]
  >`select id, finding_count, status, resolved_at from incidents where org_id = ${t.orgId}`;
  return row;
};

const timeline = (t: Tenant) =>
  sql<{ action: string; actor_id: string | null }[]>`
    select action, actor_id from incident_actions where org_id = ${t.orgId} order by created_at`;

const resolveAudits = (t: Tenant) =>
  sql<{ actor_type: string; previous: unknown; resulting: unknown }[]>`
    select actor_type, previous_state as previous, resulting_state as resulting from audit_logs
    where org_id = ${t.orgId} and action = 'incident.resolve'`;

const triage = (t: Tenant, id: string, status: 'reviewed' | 'dismissed') =>
  app.inject({
    method: 'PATCH',
    url: `/api/v1/orgs/${t.orgId}/reconciliation/findings/${id}`,
    headers: t.owner.headers,
    payload: { status, note: REASON },
  });

describe('incident refresh when findings change status', () => {
  it('recounts on dismiss, keeps reviewed findings, and auto-resolves at zero with audit', async () => {
    const t = await newTenant(harness, app);
    await addStaleEntitlement(t);
    await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    const [first = '', second = ''] = await findingIds(t);
    expect(await incident(t)).toMatchObject({ finding_count: 2, status: 'open' });

    expect((await triage(t, first, 'dismissed')).statusCode).toBe(200);
    expect(await incident(t)).toMatchObject({ finding_count: 1, status: 'open' });
    expect((await triage(t, second, 'reviewed')).statusCode).toBe(200);
    expect(await incident(t)).toMatchObject({ finding_count: 1, status: 'open' });
    expect(await resolveAudits(t)).toHaveLength(0);

    expect((await triage(t, second, 'dismissed')).statusCode).toBe(200);
    const row = await incident(t);
    expect(row).toMatchObject({ finding_count: 0, status: 'resolved' });
    expect(row?.resolved_at).not.toBeNull();
    expect(await timeline(t)).toEqual([{ action: 'resolve', actor_id: null }]);
    expect(await resolveAudits(t)).toEqual([
      {
        actor_type: 'system',
        previous: { status: 'open' },
        resulting: { status: 'resolved', via: 'findings_cleared' },
      },
    ]);
  });

  it('auto-resolves an investigating incident when resolve-finding clears the last finding', async () => {
    const t = await newTenant(harness, app);
    const entitlementId = await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    const id = (await incident(t))?.id ?? '';
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${t.orgId}/incidents/${id}/actions`,
      headers: t.owner.headers,
      payload: { action: 'acknowledge', note: REASON },
    });
    await sql`update entitlement_records set state = 'expired' where id = ${entitlementId}`;
    const [findingId = ''] = await findingIds(t);

    const res = await repairCall(app, t, t.owner, 'resolve-finding', { findingId, reason: REASON });
    expect(res.statusCode).toBe(200);
    expect(await incident(t)).toMatchObject({ finding_count: 0, status: 'resolved' });
    expect(await resolveAudits(t)).toEqual([
      expect.objectContaining({ previous: { status: 'investigating' } }),
    ]);
  });

  it('auto-resolves when correct-entitlement clears the last finding', async () => {
    const t = await newTenant(harness, app);
    await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    const [findingId = ''] = await findingIds(t);

    const res = await repairCall(app, t, t.owner, 'correct-entitlement', {
      findingId,
      reason: REASON,
    });
    expect(res.statusCode).toBe(200);
    expect(await incident(t)).toMatchObject({ finding_count: 0, status: 'resolved' });
    await addStaleEntitlement(t);
    await runLocalRecon(harness, app, t);
    const [open] = await sql<{ n: number }[]>`
      select count(*)::int as n from incidents where org_id = ${t.orgId} and status = 'open'`;
    expect(open?.n).toBe(1);
  });
});
