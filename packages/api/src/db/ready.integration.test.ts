import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { createDb } from './client';
import { TEST_DATABASE_URL } from '../test/test-database-url';

let app: FastifyInstance;
const pools: ReturnType<typeof createDb>['sql'][] = [];

afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end({ timeout: 1 })));
});

async function readyWith(url: string) {
  const { sql } = createDb(url, { max: 1 });
  pools.push(sql);
  app = await buildApp({
    logger: false,
    readinessChecks: [
      {
        name: 'database',
        check: async () => {
          await sql`select 1`;
        },
      },
    ],
  });
  return app.inject('/ready');
}

describe('GET /ready with a real database check', () => {
  it('is 200 against the test database', async () => {
    const res = await readyWith(TEST_DATABASE_URL);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('is 503 when the database is unreachable', async () => {
    const res = await readyWith('postgresql://localhost:1/payscope_test');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { database: 'fail' } });
  });
});
