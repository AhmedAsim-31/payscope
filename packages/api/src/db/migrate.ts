import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../../../supabase/migrations');

export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await migrate(drizzle({ client: sql }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end();
  }
}
