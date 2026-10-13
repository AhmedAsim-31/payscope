import { randomUUID } from 'node:crypto';
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
import { writeAudit } from './audit-log';

const harness = createHarness();
const { sql, db } = harness;
let app: FastifyInstance;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

type AuditView = {
  action: string;
  outcome: string;
  actorId: string | null;
  requestId: string | null;
};

async function audit(t: Tenant, query = '', user = t.owner) {
  const res = await app.inject({
    url: `/api/v1/orgs/${t.orgId}/audit?limit=100${query}`,
    headers: user.headers,
  });
  return { res, items: res.statusCode === 200 ? res.json<{ items: AuditView[] }>().items : [] };
}

async function oneAudit(t: Tenant) {
  const [row] = await sql<
    { id: string }[]
  >`select id from audit_logs where org_id = ${t.orgId} limit 1`;
  return row?.id ?? '';
}

describe('audit log', () => {
  it('rolls the audit row back with the mutation transaction', async () => {
    const t = await newTenant(harness, app);
    await expect(
      db.transaction(async (tx) => {
        await writeAudit(tx, {
          orgId: t.orgId,
          actorId: t.owner.id,
          action: 'test.rollback',
          targetType: 'x',
        });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await audit(t, '&action=test.rollback')).items).toHaveLength(0);
  });

  it('is append-only but still lets an org cascade delete clear it', async () => {
    const t = await newTenant(harness, app);
    const id = await oneAudit(t);
    await expect(sql`update audit_logs set reason = 'x' where id = ${id}`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from audit_logs where id = ${id}`).rejects.toThrow(/append-only/);
    await sql`delete from organizations where id = ${t.orgId}`;
    const [left] = await sql<
      { n: number }[]
    >`select count(*)::int as n from audit_logs where org_id = ${t.orgId}`;
    expect(left?.n).toBe(0);
  });

  it('records org, member, connection, finding, run and failed actions', async () => {
    const t = await newTenant(harness, app);
    const viewer = await addMemberWithRole(harness, app, t, 'VIEWER');
    const base = `/api/v1/orgs/${t.orgId}`;
    await app.inject({
      method: 'PATCH',
      url: `${base}/members/${viewer.id}`,
      headers: t.owner.headers,
      payload: { role: 'OPERATOR' },
    });
    await app.inject({
      method: 'DELETE',
      url: `${base}/members/${viewer.id}`,
      headers: t.owner.headers,
    });
    await app.inject({
      method: 'PATCH',
      url: `${base}/connections/${t.connectionId}`,
      headers: t.owner.headers,
      payload: { entitlementMap: { gold: ['pro'] } },
    });
    await app.inject({
      method: 'POST',
      url: `${base}/events/${randomUUID()}/retry`,
      headers: t.owner.headers,
    });
    const customer = await addCustomer(sql, t);
    const subId = await addSubscription(sql, t, customer, 'expired', '2020-01-01T00:00:00Z');
    await addEntitlement(sql, t, customer, 'active', subId);
    await runLocalRecon(harness, app, t);
    const [finding] = await sql<
      { id: string }[]
    >`select id from reconciliation_findings where org_id = ${t.orgId} limit 1`;
    await app.inject({
      method: 'PATCH',
      url: `${base}/reconciliation/findings/${finding?.id}`,
      headers: t.owner.headers,
      payload: { status: 'dismissed', note: REASON },
    });
    const { items } = await audit(t);
    const seen = items.map((i) => `${i.action}:${i.outcome}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        'org.create:success',
        'member.add:success',
        'member.role_change:success',
        'member.remove:success',
        'connection.update:success',
        'event.retry:failure',
        'reconciliation.run_start:success',
        'finding.dismiss:success',
      ]),
    );
    expect(items.every((i) => i.requestId)).toBe(true);
  });

  it('filters by action and is readable by a viewer', async () => {
    const t = await newTenant(harness, app);
    const viewer = await addMemberWithRole(harness, app, t, 'VIEWER');
    const filtered = await audit(t, '&action=member.add', viewer);
    expect(filtered.res.statusCode).toBe(200);
    expect(filtered.items.map((i) => i.action)).toEqual(['member.add']);
    const byActor = await audit(t, `&actor=${t.owner.id}`);
    expect(byActor.items.length).toBeGreaterThan(0);
  });

  it('hides another org and offers no write endpoint', async () => {
    const t = await newTenant(harness, app);
    const other = await newTenant(harness, app);
    expect((await audit(t, '', other.owner)).res.statusCode).toBe(404);
    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${t.orgId}/audit`,
      headers: t.owner.headers,
      payload: {},
    });
    expect(post.statusCode).toBe(404);
  });
});
