import postgres from 'postgres';

export async function resetTestDatabase(url: string): Promise<void> {
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`refusing to reset database "${dbName}": name must end with _test`);
  }
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    );
  } finally {
    await sql.end();
  }
}
