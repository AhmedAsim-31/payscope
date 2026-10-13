import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness, type TestUser } from '../test/identity-harness';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;

type Page = { items: { id: string }[]; nextCursor: string | null };
type Tenant = { orgId: string; owner: TestUser; connectionId: string };
type EventDetail = {
  status: string;
  payload: Record<string, unknown>;
  attempts: { attemptNumber: number; outcome: string }[];
  job: { status: string; maxAttempts: number; lastError: string | null } | null;
};

let a: Tenant;
let b: Tenant;
let viewer: TestUser;
let operator: TestUser;

async function createTenant(): Promise<Tenant> {
  const owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Events', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const orgId = res.json<{ id: string }>().id;
  const connectionId = randomUUID();
  await sql`insert into provider_connections (id, org_id, provider, mode, status, display_name, external_account_id)
    values (${connectionId}, ${orgId}, 'stripe', 'sandbox', 'active', 'Stripe', ${`acct_${randomUUID()}`})`;
  return { orgId, owner, connectionId };
}

async function addMember(t: Tenant, role: 'VIEWER' | 'OPERATOR'): Promise<TestUser> {
  const user = await harness.newUser();
  await app.inject({ url: '/api/v1/orgs', headers: user.headers });
  await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/members`,
    headers: t.owner.headers,
    payload: { email: user.email, role },
  });
  return user;
}

async function insertEvent(
  t: Tenant,
  over: {
    status?: string;
    receivedAt?: string;
    normalizedType?: string;
    payload?: unknown;
    jobStatus?: string | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await sql`insert into provider_events
    (id, org_id, connection_id, provider, provider_event_id, event_type, normalized_type, occurred_at, received_at, status, signature_verified, payload)
    values (${id}, ${t.orgId}, ${t.connectionId}, 'stripe', ${`evt_${id}`}, 'payment_intent.succeeded',
      ${over.normalizedType ?? 'payment.succeeded'}, now(), ${over.receivedAt ?? '2026-01-01T00:00:00.000000Z'},
      ${over.status ?? 'processed'}, true, ${JSON.stringify(over.payload ?? {})}::jsonb)`;
  if (over.jobStatus !== null) {
    await sql`insert into background_jobs (org_id, kind, payload, status, attempt_count, max_attempts, available_at, last_error, idempotency_key)
      values (${t.orgId}, 'process_provider_event', ${JSON.stringify({ eventId: id })}::jsonb, ${over.jobStatus ?? 'succeeded'},
        5, 5, now() + interval '1 day', 'boom', ${`event:${id}`})`;
  }
  return id;
}

function request<T>(user: TestUser, orgId: string, path: string, method: 'GET' | 'POST' = 'GET') {
  return app
    .inject({ method, url: `/api/v1/orgs/${orgId}${path}`, headers: user.headers })
    .then((res) => ({ status: res.statusCode, body: res.json<T>() }));
}

beforeAll(async () => {
  app = await harness.start();
  a = await createTenant();
  b = await createTenant();
  viewer = await addMember(a, 'VIEWER');
  operator = await addMember(a, 'OPERATOR');
});
afterAll(() => harness.stop());

describe('event inbox', () => {
  it('pages stably across ties in received_at', async () => {
    const tied = '2026-02-01T00:00:00.123456Z';
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await insertEvent(a, { receivedAt: tied }));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const suffix: string = cursor ? `&cursor=${cursor}` : '';
      const res = await request<Page>(
        a.owner,
        a.orgId,
        `/events?from=2026-02-01T00:00:00Z&to=2026-02-02T00:00:00Z&limit=3${suffix}`,
      );
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((i) => i.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('filters by status, provider, connection, normalized type and range, without payload', async () => {
    const hit = await insertEvent(a, {
      status: 'failed',
      normalizedType: 'refund.created',
      receivedAt: '2026-03-05T00:00:00Z',
    });
    const q = `?status=failed&provider=stripe&connectionId=${a.connectionId}&normalizedType=refund.created&from=2026-03-01T00:00:00Z&to=2026-03-10T00:00:00Z`;
    const res = await request<Page>(a.owner, a.orgId, `/events${q}`);
    expect(res.body.items.map((i) => i.id)).toEqual([hit]);
    expect(res.body.items[0]).not.toHaveProperty('payload');
    const miss = await request<Page>(a.owner, a.orgId, '/events?provider=paddle');
    expect(miss.body.items).toEqual([]);
  });

  it('redacts emails and nested secrets in the detail payload', async () => {
    const id = await insertEvent(a, {
      payload: {
        id: 'evt_x',
        data: { object: { receipt_email: 'alice@example.test', nested: { client_secret: 'sek' } } },
      },
    });
    await sql`insert into event_processing_attempts (org_id, event_id, attempt_number, outcome, ended_at)
      values (${a.orgId}, ${id}, 2, 'failed', now()), (${a.orgId}, ${id}, 1, 'failed', now())`;
    const res = await request<EventDetail>(viewer, a.orgId, `/events/${id}`);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body.payload);
    expect(raw).not.toContain('alice@example.test');
    expect(raw).not.toContain('sek');
    expect(raw).toContain('evt_x');
    expect(res.body.attempts.map((x) => x.attemptNumber)).toEqual([1, 2]);
    expect(res.body.job?.lastError).toBe('boom');
  });

  it('isolates organizations', async () => {
    const id = await insertEvent(a);
    expect((await request<unknown>(b.owner, b.orgId, `/events/${id}`)).status).toBe(404);
    const list = await request<Page>(b.owner, b.orgId, '/events?limit=100');
    expect(list.body.items.map((i) => i.id)).not.toContain(id);
    expect((await request<unknown>(b.owner, a.orgId, '/events')).status).toBe(404);
    const failed = await insertEvent(a, { status: 'failed', jobStatus: 'dead' });
    const cross = await request<unknown>(b.owner, b.orgId, `/events/${failed}/retry`, 'POST');
    expect(cross.status).toBe(409);
    const stillDead = await request<EventDetail>(a.owner, a.orgId, `/events/${failed}`);
    expect(stillDead.body.job?.status).toBe('dead');
  });
});

describe('jobs summary', () => {
  it('counts jobs by status for the org and reports the oldest queued age', async () => {
    const t = await createTenant();
    const empty = await request<{ oldestQueuedAgeSeconds: number | null }>(
      t.owner,
      t.orgId,
      '/jobs/summary',
    );
    expect(empty.body.oldestQueuedAgeSeconds).toBeNull();
    await insertEvent(t, { jobStatus: 'dead' });
    const id = await insertEvent(t, { jobStatus: 'queued', status: 'pending' });
    await sql`update background_jobs set available_at = now() - interval '90 seconds' where idempotency_key = ${`event:${id}`}`;
    const res = await request<{
      counts: Record<string, number>;
      oldestQueuedAgeSeconds: number;
    }>(t.owner, t.orgId, '/jobs/summary');
    expect(res.body.counts).toMatchObject({ queued: 1, dead: 1, running: 0 });
    expect(res.body.oldestQueuedAgeSeconds).toBeGreaterThanOrEqual(90);
  });
});

describe('retry', () => {
  it('forbids a VIEWER from retrying', async () => {
    const id = await insertEvent(a, { status: 'failed', jobStatus: 'dead' });
    expect((await request<unknown>(viewer, a.orgId, `/events/${id}/retry`, 'POST')).status).toBe(
      403,
    );
  });

  it('re-queues a dead job and resets the event; a second retry is 409', async () => {
    const id = await insertEvent(a, { status: 'needs_attention', jobStatus: 'dead' });
    const first = await request<unknown>(operator, a.orgId, `/events/${id}/retry`, 'POST');
    expect(first.status).toBe(202);
    const detail = await request<EventDetail>(operator, a.orgId, `/events/${id}`);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.job).toMatchObject({ status: 'queued', maxAttempts: 8 });
    const second = await request<{ error: { code: string } }>(
      operator,
      a.orgId,
      `/events/${id}/retry`,
      'POST',
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('NOT_RETRYABLE');
  });

  it('returns 409 for a processed event and leaves it untouched', async () => {
    const id = await insertEvent(a, { status: 'processed', jobStatus: 'succeeded' });
    const res = await request<unknown>(operator, a.orgId, `/events/${id}/retry`, 'POST');
    expect(res.status).toBe(409);
    const detail = await request<EventDetail>(operator, a.orgId, `/events/${id}`);
    expect(detail.body.status).toBe('processed');
  });

  it('rolls back the job requeue when the event is not retryable', async () => {
    const id = await insertEvent(a, { status: 'processed', jobStatus: 'dead' });
    expect((await request<unknown>(operator, a.orgId, `/events/${id}/retry`, 'POST')).status).toBe(
      409,
    );
    const detail = await request<EventDetail>(operator, a.orgId, `/events/${id}`);
    expect(detail.body.job?.status).toBe('dead');
  });
});
