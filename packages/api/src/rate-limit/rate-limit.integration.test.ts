import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '@payscope/shared/api-error';
import { createDb } from '../db/client';
import { createDefaultHandlers } from '../jobs/default-handlers';
import { createWorker } from '../jobs/worker';
import { createDefaultAdapterRegistry } from '../providers/adapter-registry';
import { createHarness } from '../test/identity-harness';
import { TEST_DATABASE_URL } from '../test/test-database-url';
import { deleteExpiredBuckets, pgRateLimitStore } from './pg-rate-limit-store';
import { DEFAULT_POLICIES, type PolicyName, type RatePolicy } from './policies';

const harness = createHarness();
const apps: FastifyInstance[] = [];

async function startWith(overrides: Partial<Record<PolicyName, RatePolicy>>, extra = {}) {
  const app = await harness.start({
    rateLimits: { ...DEFAULT_POLICIES, ...overrides },
    ...extra,
  });
  apps.push(app);
  return app;
}

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;

beforeAll(async () => {
  await harness.sql`delete from rate_limit_buckets`;
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await harness.stop();
});

describe('authenticated limits', () => {
  it('returns 429 with Retry-After and the standard error shape after max requests', async () => {
    const app = await startWith({ authenticatedRead: { max: 3, windowSec: 60 } });
    const user = await harness.newUser();
    const get = () => app.inject({ method: 'GET', url: '/api/v1/me', headers: user.headers });
    for (let i = 0; i < 3; i++) expect((await get()).statusCode).toBe(200);
    const limited = await get();
    expect(limited.statusCode).toBe(429);
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = apiErrorSchema.parse(limited.json());
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.requestId).toBe(limited.headers['x-request-id']);
  });

  it('keeps separate buckets per user', async () => {
    const app = await startWith({ authenticatedRead: { max: 1, windowSec: 60 } });
    const [a, b] = [await harness.newUser(), await harness.newUser()];
    const get = (headers: { authorization: string }) =>
      app.inject({ method: 'GET', url: '/api/v1/me', headers }).then((r) => r.statusCode);
    expect(await get(a.headers)).toBe(200);
    expect(await get(a.headers)).toBe(429);
    expect(await get(b.headers)).toBe(200);
  });

  it('allows requests again after the window resets', async () => {
    const app = await startWith({ authenticatedRead: { max: 1, windowSec: 1 } });
    const user = await harness.newUser();
    const get = () =>
      app
        .inject({ method: 'GET', url: '/api/v1/me', headers: user.headers })
        .then((r) => r.statusCode);
    expect(await get()).toBe(200);
    expect(await get()).toBe(429);
    await sleep(1100);
    expect(await get()).toBe(200);
  });

  it('lets exactly max of 50 parallel requests through', async () => {
    const app = await startWith({ authenticatedRead: { max: 10, windowSec: 60 } });
    const user = await harness.newUser();
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: 'GET', url: '/api/v1/me', headers: user.headers }),
      ),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(10);
    expect(codes.filter((c) => c === 429)).toHaveLength(40);
  });

  it('limits credential-bearing connection writes per user and org on top of the write limit', async () => {
    const app = await startWith({ credentialTest: { max: 2, windowSec: 60 } });
    const owner = await harness.newUser();
    const org = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: owner.headers,
      payload: { name: 'Limits', slug: `org-${randomUUID().slice(0, 12)}` },
    });
    const orgId = org.json<{ id: string }>().id;
    const create = () =>
      app
        .inject({
          method: 'POST',
          url: `/api/v1/orgs/${orgId}/connections`,
          headers: owner.headers,
          payload: {
            provider: 'stripe',
            mode: 'sandbox',
            displayName: 'stripe',
            externalAccountId: `acct_${randomUUID()}`,
          },
        })
        .then((r) => r.statusCode);
    expect(await create()).toBe(201);
    expect(await create()).toBe(201);
    expect(await create()).toBe(429);
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/connections`,
      headers: owner.headers,
    });
    expect(list.statusCode).toBe(200);
  });
});

describe('ip and connection limits', () => {
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const worker = () =>
    createWorker({
      db: harness.db,
      handlers: createDefaultHandlers(createDefaultAdapterRegistry()),
      logger: silent,
    });
  const tick = (app: FastifyInstance, remoteAddress: string, xff: string) =>
    app
      .inject({
        method: 'POST',
        url: '/internal/tick',
        remoteAddress,
        headers: { 'x-internal-token': 'wrong', 'x-forwarded-for': xff },
      })
      .then((r) => r.statusCode);

  it('ignores a spoofed X-Forwarded-For when TRUST_PROXY is false', async () => {
    const app = await startWith(
      { internalTick: { max: 2, windowSec: 60 } },
      { worker: worker(), internalTickToken: 'tick-token-0123456789', trustProxy: false },
    );
    const ip = randomIp();
    expect(await tick(app, ip, '1.1.1.1')).toBe(401);
    expect(await tick(app, ip, '2.2.2.2')).toBe(401);
    expect(await tick(app, ip, '3.3.3.3')).toBe(429);
  });

  it('keys by the forwarded client address when the proxy is trusted', async () => {
    const app = await startWith(
      { internalTick: { max: 1, windowSec: 60 } },
      { worker: worker(), internalTickToken: 'tick-token-0123456789', trustProxy: true },
    );
    const proxy = randomIp();
    const [a, b] = [randomIp(), randomIp()];
    expect(await tick(app, proxy, a)).toBe(401);
    expect(await tick(app, proxy, b)).toBe(401);
    expect(await tick(app, proxy, a)).toBe(429);
  });

  it('limits webhook ingress per connection id', async () => {
    const app = await startWith({ webhookIngress: { max: 2, windowSec: 60 } });
    const [a, b] = [randomUUID(), randomUUID()];
    const post = (id: string) =>
      app
        .inject({
          method: 'POST',
          url: `/webhooks/stripe/${id}`,
          headers: { 'content-type': 'application/json' },
          payload: '{}',
        })
        .then((r) => r.statusCode);
    expect(await post(a)).toBe(404);
    expect(await post(a)).toBe(404);
    expect(await post(a)).toBe(429);
    expect(await post(b)).toBe(404);
  });
});

describe('store failure', () => {
  async function closedDb() {
    const { db, sql } = createDb(TEST_DATABASE_URL, { max: 1 });
    await sql.end({ timeout: 1 });
    return db;
  }

  it('fails open and logs a warning', async () => {
    const warn = vi.fn();
    const Store = pgRateLimitStore({ db: await closedDb(), logger: { warn } });
    const result = await new Promise((resolve) => {
      new Store({}).incr('k', (_err, res) => resolve(res), 1000, 10);
    });
    expect(result).toEqual({ current: 0, ttl: 1000 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k' }),
      'rate_limit_store_failed_open',
    );
  });

  it('keeps serving requests when the limiter store is down', async () => {
    const app = await startWith(
      { authenticatedRead: { max: 1, windowSec: 60 } },
      { db: await closedDb() },
    );
    const user = await harness.newUser();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: user.headers });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('cleanup', () => {
  it('deletes buckets expired for over an hour and keeps the rest', async () => {
    const stale = `test:${randomUUID()}`;
    const recent = `test:${randomUUID()}`;
    await harness.sql`insert into rate_limit_buckets (key, count, reset_at) values
      (${stale}, 1, now() - interval '2 hours'), (${recent}, 1, now() - interval '5 minutes')`;
    await deleteExpiredBuckets(harness.db);
    const rows =
      await harness.sql`select key from rate_limit_buckets where key in (${stale}, ${recent})`;
    expect(rows.map((r) => String(r.key))).toEqual([recent]);
  });
});
