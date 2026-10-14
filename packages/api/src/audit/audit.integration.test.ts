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
import {
  addCustomer,
  addEntitlement,
  addPayment,
  addSubscription,
} from '../test/reconciliation-fixtures';
import { auditLogsTable } from '../db/schema/operations';
import { writeAudit } from './audit-log';

const harness = createHarness();
const { sql, db } = harness;
let app: FastifyInstance;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

type AuditView = {
  id: string;
  action: string;
  createdAt: string;
  outcome: string;
  actorId: string | null;
  actorEmail: string | null;
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

  async function seed(t: Tenant, action: string, at: string, extra: { reason?: string } = {}) {
    await db.insert(auditLogsTable).values({
      orgId: t.orgId,
      actorId: t.owner.id,
      actorType: 'user',
      action,
      targetType: 'search_test',
      targetId: `${action}-target`,
      outcome: 'success',
      createdAt: new Date(at),
      ...extra,
    });
  }

  it('filters by an inclusive from and exclusive to', async () => {
    const t = await newTenant(harness, app);
    await seed(t, 'range.a', '2026-01-01T00:00:00Z');
    await seed(t, 'range.b', '2026-01-02T00:00:00Z');
    await seed(t, 'range.c', '2026-01-03T00:00:00Z');
    const { items } = await audit(t, '&from=2026-01-01T00:00:00Z&to=2026-01-03T00:00:00Z');
    expect(items.map((i) => i.action)).toEqual(['range.b', 'range.a']);
    const bad = await audit(t, '&from=2026-01-03T00:00:00Z&to=2026-01-01T00:00:00Z');
    expect(bad.res.statusCode).toBe(400);
    expect((await audit(t, '&from=yesterday')).res.statusCode).toBe(400);
  });

  it('matches free text case-insensitively across action, target, actor and reason', async () => {
    const t = await newTenant(harness, app);
    await seed(t, 'text.alpha', '2026-02-01T00:00:00Z', { reason: 'Customer asked for REFUND' });
    await seed(t, 'text.beta', '2026-02-02T00:00:00Z');
    const q = async (text: string) =>
      (await audit(t, `&q=${encodeURIComponent(text)}`)).items.map((i) => i.action);
    expect(await q('  TEXT.ALPHA ')).toEqual(['text.alpha']);
    expect(await q('refund')).toEqual(['text.alpha']);
    expect(await q('beta-TARGET')).toEqual(['text.beta']);
    expect(await q('SEARCH_test')).toEqual(['text.beta', 'text.alpha']);
    expect(await q(t.owner.id.slice(0, 8))).toEqual(expect.arrayContaining(['text.alpha']));
    expect((await audit(t, `&q=${'x'.repeat(201)}`)).res.statusCode).toBe(400);
  });

  it('treats % and _ in free text literally', async () => {
    const t = await newTenant(harness, app);
    await seed(t, 'esc.plain', '2026-03-01T00:00:00Z', { reason: 'abc' });
    await seed(t, 'esc.pct', '2026-03-02T00:00:00Z', { reason: '50% off a_b' });
    const q = async (text: string) =>
      (await audit(t, `&q=${encodeURIComponent(text)}`)).items.map((i) => i.action);
    expect(await q('%')).toEqual(['esc.pct']);
    expect(await q('a_b')).toEqual(['esc.pct']);
    expect(await q('esc_p')).toEqual([]);
  });

  it('pages through filtered results with the cursor', async () => {
    const t = await newTenant(harness, app);
    for (let i = 0; i < 5; i += 1) await seed(t, `page.${i}`, `2026-04-0${i + 1}T00:00:00Z`);
    await seed(t, 'other.x', '2026-04-03T12:00:00Z');
    const seen: string[] = [];
    let cursor = '';
    for (let n = 0; n < 5; n += 1) {
      const res = await app.inject({
        url: `/api/v1/orgs/${t.orgId}/audit?limit=2&q=page&from=2026-04-02T00:00:00Z${cursor}`,
        headers: t.owner.headers,
      });
      const body = res.json<{ items: AuditView[]; nextCursor: string | null }>();
      seen.push(...body.items.map((i) => i.action));
      if (!body.nextCursor) break;
      cursor = `&cursor=${body.nextCursor}`;
    }
    expect(seen).toEqual(['page.4', 'page.3', 'page.2', 'page.1']);
  });

  it('never returns another org rows for a matching search', async () => {
    const t = await newTenant(harness, app);
    const other = await newTenant(harness, app);
    await seed(other, 'tenant.secret', '2026-05-01T00:00:00Z');
    expect((await audit(t, '&q=tenant.secret')).items).toEqual([]);
    expect((await audit(other, '&q=tenant.secret')).items).toHaveLength(1);
  });

  it('collects a customer timeline from its own, payment, subscription and entitlement rows', async () => {
    const t = await newTenant(harness, app);
    const other = await newTenant(harness, app);
    const customer = await addCustomer(sql, t);
    const stranger = await addCustomer(sql, t);
    const payment = await addPayment(sql, t, { customerId: customer });
    const strangerPayment = await addPayment(sql, t, { customerId: stranger });
    const sub = await addSubscription(sql, t, customer, 'active');
    const ent = await addEntitlement(sql, t, customer, 'active', sub);
    const target = async (o: Tenant, action: string, targetType: string, targetId: string) =>
      db.insert(auditLogsTable).values({
        orgId: o.orgId,
        actorId: null,
        actorType: 'system',
        action,
        targetType,
        targetId,
        outcome: 'success',
      });
    await target(t, 'c.own', 'customer', customer);
    await target(t, 'c.payment', 'payment', payment.id);
    await target(t, 'c.sub', 'subscription', sub);
    await target(t, 'c.ent', 'entitlement', ent);
    await target(t, 'c.stranger', 'payment', strangerPayment.id);
    await target(t, 'c.wrongtype', 'subscription', payment.id);
    await target(other, 'c.otherorg', 'payment', payment.id);
    const { res, items } = await audit(t, `&customerId=${customer}`);
    expect(res.statusCode).toBe(200);
    expect(items.map((i) => i.action).sort()).toEqual(['c.ent', 'c.own', 'c.payment', 'c.sub']);
    expect((await audit(other, `&customerId=${customer}`)).items).toEqual([]);
    expect((await audit(t, '&customerId=nope')).res.statusCode).toBe(400);
  });

  it('returns the actor email only for members of the same org', async () => {
    const t = await newTenant(harness, app);
    const other = await newTenant(harness, app);
    const row = (action: string, actorId: string | null) => ({
      orgId: t.orgId,
      actorId,
      actorType: actorId ? ('user' as const) : ('system' as const),
      action,
      targetType: 'x',
      outcome: 'success' as const,
    });
    await db
      .insert(auditLogsTable)
      .values([
        row('email.member', t.owner.id),
        row('email.outsider', other.owner.id),
        row('email.system', null),
      ]);
    const { items } = await audit(t, '&q=email.');
    const byAction = Object.fromEntries(items.map((i) => [i.action, i.actorEmail]));
    expect(byAction).toEqual({
      'email.member': t.owner.email,
      'email.outsider': null,
      'email.system': null,
    });
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
