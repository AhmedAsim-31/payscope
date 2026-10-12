import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { apiErrorSchema } from '@payscope/shared/api-error';
import { buildApp } from './app';

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

const ORIGIN = 'http://localhost:3000';

async function build(opts: Parameters<typeof buildApp>[0] = {}) {
  app = await buildApp({ logger: false, corsOrigins: [ORIGIN], ...opts });
  return app;
}

describe('health and readiness', () => {
  it('GET /health returns ok', async () => {
    await build();
    const res = await app.inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready is 200 when checks pass', async () => {
    await build({ readinessChecks: [{ name: 'db', check: () => Promise.resolve() }] });
    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { db: 'ok' } });
  });

  it('GET /ready is 503 when a check fails and leaks no message', async () => {
    await build({
      readinessChecks: [
        {
          name: 'db',
          check: () => Promise.reject(new Error('password=hunter2 refused')),
        },
      ],
    });
    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { db: 'fail' } });
    expect(res.body).not.toContain('hunter2');
  });
});

describe('errors', () => {
  it('unknown route returns the error shape with requestId', async () => {
    await build();
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('validation errors return 400 with issue details', async () => {
    await build();
    app
      .withTypeProvider<ZodTypeProvider>()
      .post('/test-validate', { schema: { body: z.object({ amount: z.int() }) } }, () => ({
        ok: true,
      }));
    const res = await app.inject({
      method: 'POST',
      url: '/test-validate',
      payload: { amount: 'x' },
    });
    expect(res.statusCode).toBe(400);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body.error.details)).toContain('amount');
  });

  it('5xx hides the internal message and stack', async () => {
    await build();
    app.get('/test-boom', () => {
      throw new Error('secret internal detail');
    });
    const res = await app.inject('/test-boom');
    expect(res.statusCode).toBe(500);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(res.body).not.toContain('secret internal detail');
    expect(res.body).not.toContain('at ');
  });

  it('4xx errors keep their message', async () => {
    await build();
    app.get('/test-conflict', (_req, reply) => reply.conflict('already exists'));
    const res = await app.inject('/test-conflict');
    expect(res.statusCode).toBe(409);
    expect(apiErrorSchema.parse(res.json()).error.message).toBe('already exists');
  });

  it('body over 1 MiB returns 413', async () => {
    await build();
    app.post('/test-body', () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/test-body',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'a'.repeat(1024 * 1024 + 1) }),
    });
    expect(res.statusCode).toBe(413);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('request ids', () => {
  it('echoes a valid UUID', async () => {
    await build();
    const id = randomUUID();
    const res = await app.inject({ url: '/health', headers: { 'x-request-id': id } });
    expect(res.headers['x-request-id']).toBe(id);
  });

  it.each([undefined, 'not-a-uuid'])('generates a UUID for %s', async (value) => {
    await build();
    const res = await app.inject({
      url: '/health',
      headers: value ? { 'x-request-id': value } : {},
    });
    const id = String(res.headers['x-request-id']);
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(id).not.toBe(value);
  });
});

describe('security headers', () => {
  it('sets helmet headers', async () => {
    await build();
    const res = await app.inject('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows the configured CORS origin with credentials', async () => {
    await build();
    const res = await app.inject({ url: '/health', headers: { origin: ORIGIN } });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow another origin', async () => {
    await build();
    const res = await app.inject({ url: '/health', headers: { origin: 'https://evil.test' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
