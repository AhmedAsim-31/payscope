import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  TEST_AUDIENCE,
  TEST_ISSUER,
  localKeySet,
  signTestToken,
} from '@payscope/test-utils/test-jwt';
import { buildApp } from '../app';
import { createTokenVerifier } from '../auth/token-verifier';
import { createDb } from '../db/client';
import { TEST_DATABASE_URL } from './test-database-url';

export type TestUser = { id: string; email: string; headers: { authorization: string } };

export function createHarness() {
  const { db, sql } = createDb(TEST_DATABASE_URL, { max: 5 });
  let app: FastifyInstance | undefined;

  async function start() {
    app = await buildApp({
      logger: false,
      db,
      tokenVerifier: createTokenVerifier({
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        keySet: localKeySet,
      }),
    });
    return app;
  }

  async function newUser(): Promise<TestUser> {
    const id = randomUUID();
    const email = `${id}@example.test`;
    const token = await signTestToken({ sub: id, email });
    return { id, email, headers: { authorization: `Bearer ${token}` } };
  }

  async function stop() {
    await app?.close();
    await sql.end({ timeout: 1 });
  }

  return { db, sql, start, newUser, stop };
}
