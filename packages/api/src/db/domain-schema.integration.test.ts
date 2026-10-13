import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './client';
import { TEST_DATABASE_URL } from '../test/test-database-url';

const { sql } = createDb(TEST_DATABASE_URL, { max: 5 });
afterAll(() => sql.end({ timeout: 1 }));

type Org = { orgId: string; userId: string; connectionId: string; customerId: string };

async function seedOrg(): Promise<Org> {
  const userId = randomUUID();
  const [org] = await sql<{ id: string }[]>`
    insert into organizations (name, slug) values ('Acme', ${`org-${randomUUID().slice(0, 12)}`}) returning id`;
  const orgId = org!.id;
  await sql`insert into profiles (id, email) values (${userId}, ${`${userId}@example.test`})`;
  await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'OWNER')`;
  const [conn] = await sql<{ id: string }[]>`
    insert into provider_connections (org_id, provider, mode, status, display_name, external_account_id)
    values (${orgId}, 'stripe', 'sandbox', 'active', 'Stripe', ${randomUUID()}) returning id`;
  const [cust] = await sql<{ id: string }[]>`
    insert into customers (org_id, email) values (${orgId}, 'c@example.test') returning id`;
  return { orgId, userId, connectionId: conn!.id, customerId: cust!.id };
}

function insertPayment(
  o: Org,
  over: { amount?: number; refunded?: number; currency?: string; connectionId?: string } = {},
) {
  return sql`
    insert into payment_records (org_id, connection_id, provider_payment_id, status, amount_minor, amount_refunded_minor, currency)
    values (${o.orgId}, ${over.connectionId ?? o.connectionId}, ${randomUUID()}, 'succeeded', ${over.amount ?? 1000}, ${over.refunded ?? 0}, ${over.currency ?? 'USD'})`;
}

function insertEvent(
  o: Org,
  providerEventId: string,
  connectionId = o.connectionId,
  payload: unknown = { ok: true },
) {
  return sql`
    insert into provider_events (org_id, connection_id, provider, provider_event_id, event_type, occurred_at, signature_verified, payload)
    values (${o.orgId}, ${connectionId}, 'stripe', ${providerEventId}, 'x', now(), true, ${JSON.stringify(payload)}::jsonb)`;
}

describe('domain schema constraints', () => {
  it('rejects a duplicate provider event on one connection but allows it on another', async () => {
    const a = await seedOrg();
    const [second] = await sql<{ id: string }[]>`
      insert into provider_connections (org_id, provider, mode, status, display_name, external_account_id)
      values (${a.orgId}, 'stripe', 'sandbox', 'active', 'Second', ${randomUUID()}) returning id`;
    await insertEvent(a, 'evt_1');
    await expect(insertEvent(a, 'evt_1')).rejects.toMatchObject({ code: '23505' });
    await expect(insertEvent(a, 'evt_1', second!.id)).resolves.toBeDefined();
  });

  it('rejects lowercase currency, negative amount, and refunded above amount', async () => {
    const a = await seedOrg();
    await expect(insertPayment(a, { currency: 'usd' })).rejects.toMatchObject({ code: '23514' });
    await expect(insertPayment(a, { amount: -1 })).rejects.toMatchObject({ code: '23514' });
    await expect(insertPayment(a, { amount: 100, refunded: 101 })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertPayment(a, { amount: 100, refunded: 100 })).resolves.toBeDefined();
  });

  it('rejects a payment that references another org connection', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await expect(insertPayment(b, { connectionId: a.connectionId })).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('rejects an oversize event payload', async () => {
    const a = await seedOrg();
    await expect(
      insertEvent(a, 'evt_big', a.connectionId, { blob: 'x'.repeat(300_000) }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('cascades every tenant row when the org is deleted', async () => {
    const a = await seedOrg();
    await insertPayment(a);
    await insertEvent(a, 'evt_c');
    await sql`insert into subscription_records (org_id, connection_id, customer_id, provider_subscription_id, status)
      values (${a.orgId}, ${a.connectionId}, ${a.customerId}, 'sub_1', 'active')`;
    await sql`insert into entitlement_records (org_id, customer_id, entitlement_key, state, source)
      values (${a.orgId}, ${a.customerId}, 'pro', 'active', 'provider_event')`;
    await sql`insert into provider_customer_mappings (org_id, connection_id, customer_id, provider_customer_id)
      values (${a.orgId}, ${a.connectionId}, ${a.customerId}, 'cus_1')`;
    await sql`insert into background_jobs (org_id, kind) values (${a.orgId}, 'process_event')`;
    await sql`insert into idempotency_records (org_id, scope, key, request_hash, expires_at)
      values (${a.orgId}, 's', 'k', 'h', now() + interval '1 day')`;
    await sql`delete from organizations where id = ${a.orgId}`;
    const tables = [
      'provider_connections',
      'customers',
      'provider_customer_mappings',
      'payment_records',
      'subscription_records',
      'entitlement_records',
      'provider_events',
      'background_jobs',
      'idempotency_records',
    ];
    for (const t of tables) {
      const [row] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${t} where org_id = $1`,
        [a.orgId],
      );
      expect(row!.n, t).toBe(0);
    }
  });
});

describe('domain schema row level security', () => {
  async function asUser<T>(userId: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
        result = await run(tx as unknown as typeof sql);
        throw new Error('rollback');
      })
      .catch((e: Error) => {
        if (e.message !== 'rollback') throw e;
      });
    return result as T;
  }

  it('shows each user only their org rows and hides idempotency records', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await insertPayment(a);
    await insertPayment(b);
    await insertEvent(a, 'evt_rls_a');
    await insertEvent(b, 'evt_rls_b');
    await sql`insert into idempotency_records (org_id, scope, key, request_hash, expires_at)
      values (${a.orgId}, 's', 'k', 'h', now() + interval '1 day')`;
    const seen = await asUser(a.userId, async (tx) => ({
      payments: await tx<{ org_id: string }[]>`select org_id from payment_records`,
      events: await tx<{ org_id: string }[]>`select org_id from provider_events`,
    }));
    expect(seen.payments.length).toBeGreaterThan(0);
    expect(seen.payments.every((r) => r.org_id === a.orgId)).toBe(true);
    expect(seen.events.length).toBeGreaterThan(0);
    expect(seen.events.every((r) => r.org_id === a.orgId)).toBe(true);
    await expect(
      asUser(a.userId, (tx) => tx`select id from idempotency_records`),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('hides connection credentials from authenticated users', async () => {
    const a = await seedOrg();
    await expect(
      asUser(a.userId, (tx) => tx`select credentials_ciphertext from provider_connections`),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
