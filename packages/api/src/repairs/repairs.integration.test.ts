import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness } from '../test/identity-harness';
import {
  addCustomer,
  addEntitlement,
  addPayment,
  addSubscription,
} from '../test/reconciliation-fixtures';
import {
  addMemberWithRole,
  findingIdOf,
  newTenant,
  REASON,
  repairCall,
  runLocalRecon,
  type Tenant,
} from '../test/ops-harness';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

const PAST = '2020-01-01T00:00:00Z';
const FUTURE = '2099-01-01T00:00:00Z';

async function expiredScenario(t: Tenant) {
  const customer = await addCustomer(sql, t);
  const subId = await addSubscription(sql, t, customer, 'expired', PAST);
  const entitlementId = await addEntitlement(sql, t, customer, 'active', subId);
  await runLocalRecon(harness, app, t);
  return {
    entitlementId,
    findingId: await findingIdOf(harness, t, 'expired_externally_active_locally'),
  };
}

async function missingScenario(t: Tenant) {
  await sql`update provider_connections set entitlement_map = '{"gold":["pro"]}'::jsonb where id = ${t.connectionId}`;
  const customer = await addCustomer(sql, t);
  await addPayment(sql, t, { customerId: customer });
  const subId = await addSubscription(sql, t, customer, 'active', FUTURE);
  await sql`update subscription_records set plan_ref = 'gold' where id = ${subId}`;
  await runLocalRecon(harness, app, t);
  return { customer, findingId: await findingIdOf(harness, t, 'entitlement_missing_or_stale') };
}

const auditCount = async (t: Tenant, action: string) => {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from audit_logs where org_id = ${t.orgId} and action = ${action}`;
  return row?.n;
};

describe('repair center', () => {
  it('expires a stale entitlement, resolves the finding, audits, and clears on re-run', async () => {
    const t = await newTenant(harness, app);
    const { entitlementId, findingId } = await expiredScenario(t);
    const res = await repairCall(app, t, t.owner, 'correct-entitlement', {
      findingId,
      reason: REASON,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      previousState: { entitlement: 'active' },
      resultingState: { entitlement: 'expired' },
    });
    const [ent] =
      await sql`select state, source from entitlement_records where id = ${entitlementId}`;
    expect(ent).toMatchObject({ state: 'expired', source: 'manual_repair' });
    const [finding] =
      await sql`select status, resolution_note from reconciliation_findings where id = ${findingId}`;
    expect(finding).toMatchObject({ status: 'resolved', resolution_note: REASON });
    expect(await auditCount(t, 'repair.correct_entitlement')).toBe(1);
    await runLocalRecon(harness, app, t);
    const [open] = await sql<{ n: number }[]>`
      select count(*)::int as n from reconciliation_findings where org_id = ${t.orgId} and status = 'open'`;
    expect(open?.n).toBe(0);
  });

  it('grants the missing entitlement from the connection plan map', async () => {
    const t = await newTenant(harness, app);
    const { customer, findingId } = await missingScenario(t);
    const res = await repairCall(app, t, t.owner, 'correct-entitlement', {
      findingId,
      reason: REASON,
    });
    expect(res.statusCode).toBe(200);
    const [ent] =
      await sql`select state, source, entitlement_key from entitlement_records where customer_id = ${customer}`;
    expect(ent).toMatchObject({ state: 'active', source: 'manual_repair', entitlement_key: 'pro' });
    const again = await repairCall(app, t, t.owner, 'correct-entitlement', {
      findingId,
      reason: REASON,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'FINDING_CLOSED' } });
  });

  it('replays the stored response for the same key and rejects a different body with 422', async () => {
    const t = await newTenant(harness, app);
    const { findingId } = await expiredScenario(t);
    const key = randomUUID();
    const body = { findingId, reason: REASON };
    const first = await repairCall(app, t, t.owner, 'correct-entitlement', body, key);
    const replay = await repairCall(app, t, t.owner, 'correct-entitlement', body, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await auditCount(t, 'repair.correct_entitlement')).toBe(1);
    const mismatch = await repairCall(
      app,
      t,
      t.owner,
      'correct-entitlement',
      { ...body, reason: `${REASON} twice` },
      key,
    );
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('validates the key header and the reason length', async () => {
    const t = await newTenant(harness, app);
    const body = { findingId: randomUUID(), reason: REASON };
    expect((await repairCall(app, t, t.owner, 'resolve-finding', body, '')).statusCode).toBe(400);
    const short = await repairCall(app, t, t.owner, 'resolve-finding', {
      ...body,
      reason: 'too short',
    });
    expect(short.statusCode).toBe(400);
  });

  it('answers 409 STILL_DETECTED until the inconsistency is gone', async () => {
    const t = await newTenant(harness, app);
    const { entitlementId, findingId } = await expiredScenario(t);
    const blocked = await repairCall(app, t, t.owner, 'resolve-finding', {
      findingId,
      reason: REASON,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'STILL_DETECTED' } });
    expect(await auditCount(t, 'repair.resolve_finding')).toBe(1);
    await sql`update entitlement_records set state = 'expired' where id = ${entitlementId}`;
    const ok = await repairCall(app, t, t.owner, 'resolve-finding', { findingId, reason: REASON });
    expect(ok.statusCode).toBe(200);
    const [finding] = await sql`select status from reconciliation_findings where id = ${findingId}`;
    expect(finding?.status).toBe('resolved');
  });

  it('re-queues a processed event', async () => {
    const t = await newTenant(harness, app);
    const [event] = await sql<{ id: string }[]>`
      insert into provider_events (org_id, connection_id, provider, provider_event_id, event_type,
        normalized_type, occurred_at, status, signature_verified, payload, object_ref)
      values (${t.orgId}, ${t.connectionId}, 'stripe', ${`evt_${randomUUID()}`}, 'x', 'payment.succeeded',
        now(), 'processed', true, '{}'::jsonb, 'pi_1') returning id`;
    const eventId = event?.id ?? '';
    await sql`insert into background_jobs (org_id, kind, payload, status, idempotency_key)
      values (${t.orgId}, 'process_provider_event', ${JSON.stringify({ eventId })}::jsonb, 'succeeded', ${`event:${eventId}`})`;
    const res = await repairCall(app, t, t.owner, 'reprocess-event', { eventId, reason: REASON });
    expect(res.statusCode).toBe(200);
    const [row] = await sql`select e.status as event, j.status as job from provider_events e
      join background_jobs j on j.idempotency_key = 'event:' || e.id::text where e.id = ${eventId}`;
    expect(row).toMatchObject({ event: 'pending', job: 'queued' });
    const busy = await repairCall(app, t, t.owner, 'reprocess-event', { eventId, reason: REASON });
    expect(busy.statusCode).toBe(409);
  });

  it('enforces the role matrix and hides other orgs', async () => {
    const t = await newTenant(harness, app);
    const other = await newTenant(harness, app);
    const viewer = await addMemberWithRole(harness, app, t, 'VIEWER');
    const operator = await addMemberWithRole(harness, app, t, 'OPERATOR');
    const body = { findingId: randomUUID(), reason: REASON };
    expect((await repairCall(app, t, viewer, 'resolve-finding', body)).statusCode).toBe(403);
    expect((await repairCall(app, t, operator, 'resolve-finding', body)).statusCode).toBe(404);
    expect((await repairCall(app, t, other.owner, 'resolve-finding', body)).statusCode).toBe(404);
    const { findingId } = await expiredScenario(t);
    const foreign = await repairCall(app, other, other.owner, 'resolve-finding', {
      findingId,
      reason: REASON,
    });
    expect(foreign.statusCode).toBe(404);
    const done = await repairCall(app, t, operator, 'correct-entitlement', {
      findingId,
      reason: REASON,
    });
    expect(done.statusCode).toBe(200);
  });
});
