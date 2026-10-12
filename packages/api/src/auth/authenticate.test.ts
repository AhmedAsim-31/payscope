import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { apiErrorSchema } from '@payscope/shared/api-error';
import {
  TEST_AUDIENCE,
  TEST_ISSUER,
  generateTestKeyPair,
  localKeySet,
  signTestToken,
} from '@payscope/test-utils/test-jwt';
import { buildApp } from '../app';
import { createTokenVerifier } from './token-verifier';

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

const tokenVerifier = createTokenVerifier({
  issuer: TEST_ISSUER,
  audience: TEST_AUDIENCE,
  keySet: localKeySet,
});

async function build(opts: Parameters<typeof buildApp>[0] = {}) {
  app = await buildApp({ logger: false, tokenVerifier, ...opts });
  return app;
}

function getMe(authorization?: string) {
  return app.inject({
    url: '/api/v1/me',
    headers: authorization === undefined ? {} : { authorization },
  });
}

function expectRejected(res: Awaited<ReturnType<typeof getMe>>, code: string) {
  expect(res.statusCode).toBe(401);
  expect(res.headers['www-authenticate']).toBe('Bearer');
  const body = apiErrorSchema.parse(res.json());
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe(res.headers['x-request-id']);
}

describe('GET /api/v1/me', () => {
  it('returns the caller for a valid token', async () => {
    await build();
    const sub = randomUUID();
    const token = await signTestToken({ sub, email: 'a@b.test' });
    const res = await getMe(`Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: sub, email: 'a@b.test' });
  });

  it('accepts a lowercase scheme', async () => {
    await build();
    const res = await getMe(`bearer ${await signTestToken()}`);
    expect(res.statusCode).toBe(200);
  });

  it('rejects a missing header', async () => {
    await build();
    expectRejected(await getMe(), 'UNAUTHENTICATED');
  });

  it.each(['Basic x', 'Bearer', 'Bearer ', 'Bearer a b', 'x'])(
    'rejects malformed header %j',
    async (header) => {
      await build();
      expectRejected(await getMe(header), 'UNAUTHENTICATED');
    },
  );

  it('rejects an expired token', async () => {
    await build();
    const expired = Math.floor(Date.now() / 1000) - 60;
    const token = await signTestToken({}, { expiresIn: expired });
    expectRejected(await getMe(`Bearer ${token}`), 'TOKEN_EXPIRED');
  });

  it('rejects a wrong issuer', async () => {
    await build();
    const token = await signTestToken({}, { issuer: 'https://evil.test/auth/v1' });
    expectRejected(await getMe(`Bearer ${token}`), 'INVALID_TOKEN');
  });

  it('rejects a wrong audience', async () => {
    await build();
    const token = await signTestToken({}, { audience: 'anon' });
    expectRejected(await getMe(`Bearer ${token}`), 'INVALID_TOKEN');
  });

  it('rejects a token signed by a different key', async () => {
    await build();
    const { privateKey } = await generateTestKeyPair();
    const token = await signTestToken({}, { signingKey: privateKey });
    expectRejected(await getMe(`Bearer ${token}`), 'INVALID_TOKEN');
  });

  it('rejects an HS256 token', async () => {
    await build();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(randomUUID())
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    expectRejected(await getMe(`Bearer ${token}`), 'INVALID_TOKEN');
  });

  it('rejects an alg none token', async () => {
    await build();
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({
      sub: randomUUID(),
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    expectRejected(await getMe(`Bearer ${token}`), 'INVALID_TOKEN');
  });

  it('rejects a non-UUID sub', async () => {
    await build();
    const token = await signTestToken({ sub: 'not-a-uuid' });
    expectRejected(await getMe(`Bearer ${token}`), 'INVALID_TOKEN');
  });
});

describe('auth logging', () => {
  it('never logs the token or authorization header', async () => {
    const lines: string[] = [];
    await build({
      logger: undefined,
      logLevel: 'trace',
      logStream: { write: (m) => lines.push(m) },
    });
    const good = await signTestToken();
    const bad = await signTestToken({}, { audience: 'anon' });
    expect((await getMe(`Bearer ${good}`)).statusCode).toBe(200);
    expect((await getMe(`Bearer ${bad}`)).statusCode).toBe(401);
    const logs = lines.join('');
    expect(logs).toContain('request completed');
    expect(logs).not.toContain(good);
    expect(logs).not.toContain(bad);
  });
});
