import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './client';
import { runMigrations } from './migrate';
import { TEST_DATABASE_URL } from '../test/test-database-url';
import { resetTestDatabase } from '../test/reset-test-database';

const { sql } = createDb(TEST_DATABASE_URL, { max: 2 });

afterAll(() => sql.end());

describe('supabase_local_compat migration', () => {
  it('is applied once and a second run is a no-op', async () => {
    const count = async () => {
      const [row] = await sql<
        { n: number }[]
      >`select count(*)::int as n from drizzle.__drizzle_migrations`;
      return row?.n;
    };
    const before = await count();
    await runMigrations(TEST_DATABASE_URL);
    expect(await count()).toBe(before);
    expect(before).toBeGreaterThanOrEqual(1);
  });

  it('creates the Supabase roles and auth.users', async () => {
    const roles =
      await sql`select rolname from pg_roles where rolname in ('anon','authenticated','service_role')`;
    expect(roles).toHaveLength(3);
    const [t] = await sql`select to_regclass('auth.users') as t`;
    expect(t?.t).toBe('auth.users');
  });

  it('auth.uid() reads the jwt sub claim', async () => {
    const sub = '7b0c7d52-5a6a-4a38-8a4c-3d1f2c9a1e11';
    const [row] = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${sub}, true)`;
      return tx`select auth.uid() as uid`;
    });
    expect(row?.uid).toBe(sub);
    const [unset] = await sql`select auth.uid() as uid`;
    expect(unset?.uid).toBeNull();
  });

  it('the reset guard refuses a non-test database', async () => {
    await expect(resetTestDatabase('postgresql://localhost:5432/payscope')).rejects.toThrow(
      /_test/,
    );
  });
});
