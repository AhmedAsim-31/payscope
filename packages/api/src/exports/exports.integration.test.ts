import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Role } from '@payscope/shared/permissions';
import { createHarness, type TestUser } from '../test/identity-harness';
import { EXPORT_MAX_ROWS } from './export-routes';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

type Tenant = { orgId: string; owner: TestUser; connectionId: string; customerId: string };
let a: Tenant;
let b: Tenant;

async function createTenant(): Promise<Tenant> {
  const owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Exports', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const orgId = res.json<{ id: string }>().id;
  const connectionId = randomUUID();
  const customerId = randomUUID();
  await sql`insert into provider_connections (id, org_id, provider, mode, status, display_name, external_account_id)
    values (${connectionId}, ${orgId}, 'stripe', 'sandbox', 'active', 'Stripe', ${`acct_${randomUUID()}`})`;
  await sql`insert into customers (id, org_id, email, display_name)
    values (${customerId}, ${orgId}, '=HYPERLINK("http://evil")@example.test', 'Eve')`;
  return { orgId, owner, connectionId, customerId };
}

async function insertPayment(
  t: Tenant,
  over: { status?: string; amount?: string; currency?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await sql`insert into payment_records
    (id, org_id, connection_id, customer_id, provider_payment_id, status, amount_minor, currency)
    values (${id}, ${t.orgId}, ${t.connectionId}, ${t.customerId}, ${`pi_${id}`},
      ${over.status ?? 'succeeded'}, ${over.amount ?? '1000'}, ${over.currency ?? 'USD'})`;
  return id;
}

async function insertFinding(t: Tenant, severity: string): Promise<string> {
  const [run] = await sql<{ id: string }[]>`insert into reconciliation_runs (org_id, mode, status)
    values (${t.orgId}, 'local', 'completed') returning id`;
  const [row] = await sql<{ id: string }[]>`insert into reconciliation_findings
    (org_id, type, severity, subject_type, subject_id, fingerprint, recommended_action, first_seen_run_id, last_seen_run_id)
    values (${t.orgId}, 'status_mismatch', ${severity}, 'payment', ${randomUUID()}, ${randomUUID()},
      '-review then fix', ${run?.id ?? ''}, ${run?.id ?? ''})
    returning id`;
  return row?.id ?? '';
}

async function addMember(t: Tenant, role: Role): Promise<TestUser> {
  const user = await harness.newUser();
  await app.inject({ url: '/api/v1/orgs', headers: user.headers });
  await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/members`,
    headers: t.owner.headers,
    payload: { email: user.email, role },
  });
  return user;
}

function exportCsv(user: TestUser, orgId: string, path: string) {
  return app.inject({ url: `/api/v1/orgs/${orgId}${path}`, headers: user.headers });
}

function rows(body: string): string[][] {
  return body
    .trimEnd()
    .split('\r\n')
    .map((line) => line.split(','));
}

beforeAll(async () => {
  app = await harness.start();
  a = await createTenant();
  b = await createTenant();
});
afterAll(() => harness.stop());

describe('payments export', () => {
  it('returns a CSV attachment with integer minor units and a currency column', async () => {
    const big = '9007199254740993123';
    const id = await insertPayment(a, { amount: big, currency: 'EUR', status: 'failed' });
    const res = await exportCsv(a.owner, a.orgId, '/payments/export?status=failed&currency=EUR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="payments-.*\.csv"$/);
    expect(res.headers['x-export-truncated']).toBe('false');
    const [header, ...data] = rows(res.body);
    expect(data).toHaveLength(1);
    const record = Object.fromEntries((header ?? []).map((h, i) => [h, data[0]?.[i]]));
    expect(record.id).toBe(id);
    expect(record.amount_minor).toBe(big);
    expect(record.amount_refunded_minor).toBe('0');
    expect(record.currency).toBe('EUR');
  });

  it('honors list filters and keeps other organizations out', async () => {
    const aId = await insertPayment(a, { status: 'refunded' });
    const bId = await insertPayment(b, { status: 'refunded' });
    const res = await exportCsv(a.owner, a.orgId, '/payments/export?status=refunded');
    expect(res.body).toContain(aId);
    expect(res.body).not.toContain(bId);
    const notMember = await exportCsv(b.owner, a.orgId, '/payments/export');
    expect(notMember.statusCode).toBe(404);
  });

  it('rejects an inverted amount range like the list endpoint', async () => {
    const res = await exportCsv(a.owner, a.orgId, '/payments/export?minAmount=200&maxAmount=100');
    expect(res.statusCode).toBe(422);
  });

  it('neutralizes formula injection in customer data', async () => {
    await insertPayment(a, { status: 'disputed' });
    const res = await exportCsv(a.owner, a.orgId, '/payments/export?status=disputed');
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"")@example.test"`);
  });

  it('caps the row count and flags truncation', async () => {
    const t = await createTenant();
    await sql`insert into payment_records
      (org_id, connection_id, provider_payment_id, status, amount_minor, currency)
      select ${t.orgId}, ${t.connectionId}, 'pi_bulk_' || n, 'succeeded', n, 'USD'
      from generate_series(1, ${EXPORT_MAX_ROWS + 1}) as n`;
    const res = await exportCsv(t.owner, t.orgId, '/payments/export');
    expect(res.headers['x-export-truncated']).toBe('true');
    expect(rows(res.body)).toHaveLength(EXPORT_MAX_ROWS + 1);
  });
});

describe('findings export', () => {
  it('honors filters, isolates organizations and escapes text', async () => {
    const high = await insertFinding(a, 'high');
    const low = await insertFinding(a, 'low');
    const other = await insertFinding(b, 'high');
    const res = await exportCsv(a.owner, a.orgId, '/reconciliation/findings/export?severity=high');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(high);
    expect(res.body).not.toContain(low);
    expect(res.body).not.toContain(other);
    expect(res.body).toContain(`'-review then fix`);
  });
});

describe('export role gate', () => {
  it('lets an operator export and forbids a viewer', async () => {
    const operator = await addMember(a, 'OPERATOR');
    const viewer = await addMember(a, 'VIEWER');
    expect((await exportCsv(operator, a.orgId, '/payments/export')).statusCode).toBe(200);
    for (const path of ['/payments/export', '/reconciliation/findings/export']) {
      const res = await exportCsv(viewer, a.orgId, path);
      expect(res.statusCode).toBe(403);
    }
    expect((await exportCsv(viewer, a.orgId, '/payments')).statusCode).toBe(200);
  });
});
