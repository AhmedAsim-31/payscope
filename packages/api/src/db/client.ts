import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, {
    prepare: false,
    max: opts.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { db: drizzle({ client: sql }), sql };
}

export type Db = ReturnType<typeof createDb>['db'];
