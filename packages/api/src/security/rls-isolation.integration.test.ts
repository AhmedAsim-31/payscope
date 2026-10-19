import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness } from '../test/identity-harness';
import { seedTenant, UNLIMITED_RATE_LIMITS, type Tenant } from './tenant-fixture';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;
let a: Tenant;
let b: Tenant;

const SEEDED_TABLES = [
  'customers',
  'payment_records',
  'subscription_records',
  'entitlement_records',
  'provider_events',
  'provider_connections',
  'reconciliation_runs',
  'reconciliation_findings',
  'memberships',
];

const PERMISSION_DENIED = '42501';

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

/** Row count visible to the user, or 'denied' when the role has no grant on the table. */
function visibleCount(userId: string, table: string, orgId: string) {
  return asUser(userId, async (tx) => {
    try {
      const [row] = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${table} where org_id = $1`,
        [orgId],
      );
      return row?.n ?? 0;
    } catch (e) {
      if ((e as { code?: string }).code === PERMISSION_DENIED) return 'denied' as const;
      throw e;
    }
  });
}

beforeAll(async () => {
  app = await harness.start({ rateLimits: UNLIMITED_RATE_LIMITS });
  a = await seedTenant(harness, app);
  b = await seedTenant(harness, app);
});
afterAll(() => harness.stop());

describe('row level security', () => {
  it('hides every org_id table of another org from an authenticated member', async () => {
    const tables = await sql<{ table_name: string }[]>`
      select c.table_name from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'`;
    expect(tables.length).toBeGreaterThanOrEqual(13);
    const leaks: string[] = [];
    for (const { table_name } of tables) {
      const seen = await visibleCount(a.users.OWNER.id, table_name, b.orgId);
      if (seen !== 0 && seen !== 'denied') leaks.push(`${table_name}: ${seen}`);
    }
    expect(leaks).toEqual([]);
  });

  it('still shows a member their own org rows', async () => {
    for (const table of SEEDED_TABLES) {
      const own = await visibleCount(a.users.VIEWER.id, table, a.orgId);
      expect(own, table).toBeGreaterThan(0);
    }
  });

  it('exposes no rows of tables without a select policy', async () => {
    for (const table of ['idempotency_records', 'rate_limit_buckets']) {
      const seen = await asUser(a.users.OWNER.id, async (tx) => {
        try {
          const [row] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`);
          return row?.n ?? 0;
        } catch (e) {
          if ((e as { code?: string }).code === PERMISSION_DENIED) return 0;
          throw e;
        }
      });
      expect(seen, table).toBe(0);
    }
  });

  it('does not let authenticated select connection credential columns', async () => {
    const denied = await asUser(a.users.OWNER.id, async (tx) => {
      try {
        await tx`select credentials_ciphertext from provider_connections`;
        return false;
      } catch (e) {
        return (e as { code?: string }).code === PERMISSION_DENIED;
      }
    });
    expect(denied).toBe(true);
    const granted = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'provider_connections'
        and column_name ~ 'credential|secret'
        and has_column_privilege('authenticated', 'public.provider_connections', column_name, 'SELECT')`;
    expect(granted).toEqual([]);
  });

  it('does not let authenticated select raw payload or state columns', async () => {
    const rows = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('provider_events', 'payload'), ('background_jobs', 'payload'),
          ('background_jobs', 'last_error'), ('audit_logs', 'previous_state'),
          ('audit_logs', 'resulting_state'))
        and has_column_privilege('authenticated', format('public.%I', table_name), column_name, 'SELECT')`;
    expect(rows).toEqual([]);
  });
});
