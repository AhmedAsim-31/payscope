import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

type ApiErr = { error: { code: string; message: string } };
const ORIGIN = 'http://localhost:3000';
let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

async function build(hsts = false) {
  app = await buildApp({ logger: false, corsOrigins: [ORIGIN], hsts });
  app.get('/api/v1/probe', () => ({ ok: true }));
  app.post('/api/v1/echo', (request) => ({ received: typeof request.body }));
  return app;
}

function nested(depth: number): string {
  return '['.repeat(depth) + ']'.repeat(depth);
}

describe('response headers', () => {
  it('sets frameguard, nosniff, and no-referrer on every response', async () => {
    await build();
    const res = await app.inject('/health');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sends HSTS only when enabled', async () => {
    await build();
    expect((await app.inject('/health')).headers['strict-transport-security']).toBeUndefined();
    await app.close();
    await build(true);
    expect((await app.inject('/health')).headers['strict-transport-security']).toContain(
      'max-age=63072000',
    );
  });

  it('marks /api/v1 responses no-store, including errors, but not health', async () => {
    await build();
    for (const url of ['/api/v1/probe', '/api/v1/missing']) {
      expect((await app.inject(url)).headers['cache-control']).toBe('no-store');
    }
    expect((await app.inject('/health')).headers['cache-control']).not.toBe('no-store');
  });
});

describe('cors', () => {
  it('answers a preflight from an allowed origin', async () => {
    await build();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/echo',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toBe('GET, HEAD, POST, PATCH, DELETE');
  });

  it('gives a preflight from a disallowed origin no allow headers', async () => {
    await build();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/echo',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request limits', () => {
  it('rejects a GET that carries a JSON body', async () => {
    await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/probe',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":1}',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErr>().error.code).toBe('BAD_REQUEST');
  });

  it('rejects an API body over 64 KiB and accepts one just under', async () => {
    await build();
    const post = (size: number) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/echo',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ pad: 'x'.repeat(size) }),
      });
    expect((await post(60 * 1024)).statusCode).toBe(200);
    expect((await post(65 * 1024)).statusCode).toBe(413);
  });

  it('rejects JSON nested deeper than 20 levels', async () => {
    await build();
    const post = (payload: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/echo',
        headers: { 'content-type': 'application/json' },
        payload,
      });
    expect((await post(nested(10))).statusCode).toBe(200);
    const deep = await post(nested(21));
    expect(deep.statusCode).toBe(400);
    expect(deep.json<ApiErr>().error.message).toContain('nested');
  });
});
