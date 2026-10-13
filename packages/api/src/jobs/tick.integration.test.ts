import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness } from '../test/identity-harness';
import { seedConnection } from '../test/reconciliation-fixtures';
import { parkQueuedJobs } from '../test/job-fixtures';
import { STRIPE_SECRET, stripeEvent, stripeHeaders } from '../test/webhook-fixtures';
import { createDefaultAdapterRegistry } from '../providers/adapter-registry';
import { createDefaultHandlers } from './default-handlers';
import { createWorker, type Worker } from './worker';

const TOKEN = 'tick-token-0123456789';
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const harness = createHarness();
let app: FastifyInstance;
let connectionId: string;
let orgId: string;
let worker: Worker;

beforeAll(async () => {
  await parkQueuedJobs(harness.sql);
  worker = createWorker({
    db: harness.db,
    handlers: createDefaultHandlers(createDefaultAdapterRegistry()),
    logger: silent,
  });
  app = await harness.start({ worker, internalTickToken: TOKEN, reconciliationIntervalHours: 0 });
  const owner = await harness.newUser();
  const org = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Tick', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  orgId = org.json<{ id: string }>().id;
  const conn = await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/connections`,
    headers: owner.headers,
    payload: {
      provider: 'stripe',
      mode: 'sandbox',
      displayName: 'stripe',
      externalAccountId: `acct_${randomUUID()}`,
      webhookSecrets: [STRIPE_SECRET],
    },
  });
  connectionId = conn.json<{ id: string }>().id;
});
afterAll(() => harness.stop());

async function ingest(fixture: string) {
  const event = stripeEvent(fixture);
  const body = JSON.stringify(event);
  const res = await app.inject({
    method: 'POST',
    url: `/webhooks/stripe/${connectionId}`,
    headers: stripeHeaders(body),
    payload: body,
  });
  expect(res.statusCode).toBe(200);
  return event.id;
}

function eventRow(providerEventId: string) {
  return harness.sql<
    { status: string; normalized_type: string | null; attempts: number; outcomes: string[] }[]
  >`
    select e.status, e.normalized_type,
           (select count(*)::int from event_processing_attempts a where a.event_id = e.id) as attempts,
           coalesce((select array_agg(a.outcome::text) from event_processing_attempts a
                     where a.event_id = e.id), '{}') as outcomes
    from provider_events e
    where e.connection_id = ${connectionId} and e.provider_event_id = ${providerEventId}`;
}

describe('POST /internal/tick', () => {
  it('rejects a missing or wrong token', async () => {
    const none = await app.inject({ method: 'POST', url: '/internal/tick' });
    const wrong = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-internal-token': 'wrong-token-0123456789' },
    });
    expect(none.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
  });

  it('drains an ingested event to processed with an attempt row', async () => {
    const eventId = await ingest('payment-intent-succeeded');
    const [before] = await eventRow(eventId);
    expect(before).toMatchObject({ status: 'pending', attempts: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-internal-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ claimed: number }>().claimed).toBeGreaterThanOrEqual(1);

    const [after] = await eventRow(eventId);
    expect(after).toMatchObject({
      status: 'processed',
      normalized_type: 'payment.succeeded',
      attempts: 1,
      outcomes: ['succeeded'],
    });
    const [job] = await harness.sql<{ status: string }[]>`
      select j.status from background_jobs j
      join provider_events e on j.idempotency_key = 'event:' || e.id::text
      where e.provider_event_id = ${eventId}`;
    expect(job?.status).toBe('succeeded');
  });

  it('marks an unsupported event type ignored', async () => {
    const eventId = await ingest('unsupported-customer-created');
    await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-internal-token': TOKEN },
    });
    const [row] = await eventRow(eventId);
    expect(row).toMatchObject({
      status: 'ignored',
      normalized_type: 'unsupported',
      outcomes: ['skipped'],
    });
  });

  it('starts a scheduled reconciliation run for an org with an active connection', async () => {
    await seedConnection(harness.sql, orgId);
    const scheduling = createHarness();
    const schedulingApp = await scheduling.start({ worker, internalTickToken: TOKEN });
    const res = await schedulingApp.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-internal-token': TOKEN },
    });
    expect(res.json<{ scheduled: number }>().scheduled).toBeGreaterThanOrEqual(1);
    const runs = await harness.sql<{ trigger: string; triggered_by: string | null }[]>`
      select trigger, triggered_by from reconciliation_runs where org_id = ${orgId}`;
    expect(runs).toEqual([{ trigger: 'scheduled', triggered_by: null }]);
    await scheduling.stop();
  });

  it('prunes expired rows and reports the counts per table', async () => {
    const [job] = await harness.sql<{ id: string }[]>`
      insert into background_jobs (org_id, kind, status, updated_at)
      values (${orgId}, 'test', 'dead', '1990-01-01T00:00:00Z') returning id`;
    const res = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-internal-token': TOKEN },
    });
    const { pruned } = res.json<{ pruned: Record<string, number> }>();
    expect(Object.keys(pruned).sort()).toEqual([
      'auditLogs',
      'backgroundJobs',
      'eventPayloads',
      'idempotencyRecords',
      'scenarioRuns',
    ]);
    expect(pruned.backgroundJobs).toBeGreaterThanOrEqual(1);
    const left = await harness.sql`select 1 from background_jobs where id = ${job?.id ?? ''}`;
    expect(left).toHaveLength(0);
  });

  it('is not registered when no token is configured', async () => {
    const bare = createHarness();
    const bareApp = await bare.start();
    const res = await bareApp.inject({ method: 'POST', url: '/internal/tick' });
    expect(res.statusCode).toBe(404);
    await bare.stop();
  });
});
