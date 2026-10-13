import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '@payscope/shared/api-error';
import { createHarness } from '../test/identity-harness';
import {
  PADDLE_SECRET,
  STRIPE_SECRET,
  paddleEvent,
  paddleHeaders,
  stripeEvent,
  stripeHeaders,
} from '../test/webhook-fixtures';

const harness = createHarness();
let app: FastifyInstance;
let stripeConnectionId: string;
let paddleConnectionId: string;
const SECOND_SECRET = 'whsec_test_rotated_secret';

beforeAll(async () => {
  app = await harness.start();
  const owner = await harness.newUser();
  const org = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Ingress', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const orgId = org.json<{ id: string }>().id;
  const create = async (provider: string, secret: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/connections`,
      headers: owner.headers,
      payload: {
        provider,
        mode: 'sandbox',
        displayName: provider,
        externalAccountId: `acct_${randomUUID()}`,
        webhookSecrets: [secret],
      },
    });
    return res.json<{ id: string }>().id;
  };
  stripeConnectionId = await create('stripe', STRIPE_SECRET);
  paddleConnectionId = await create('paddle', PADDLE_SECRET);
});
afterAll(() => harness.stop());

function post(
  provider: string,
  connectionId: string,
  body: string,
  headers: Record<string, string>,
) {
  return app.inject({
    method: 'POST',
    url: `/webhooks/${provider}/${connectionId}`,
    headers,
    payload: body,
  });
}

async function counts(connectionId: string) {
  const [events] = await harness.sql<{ n: number }[]>`
    select count(*)::int as n from provider_events where connection_id = ${connectionId}`;
  const [jobs] = await harness.sql<{ n: number }[]>`
    select count(*)::int as n from background_jobs j
    join provider_events e on j.idempotency_key = 'event:' || e.id::text
    where e.connection_id = ${connectionId}`;
  return { events: events?.n, jobs: jobs?.n };
}

describe('webhook ingress', () => {
  it('persists a valid Stripe event and enqueues one job', async () => {
    const body = JSON.stringify(stripeEvent());
    const res = await post('stripe', stripeConnectionId, body, stripeHeaders(body));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, duplicate: false });
    const [row] = await harness.sql<
      { status: string; signature_verified: boolean; normalized_type: string; kind: string }[]
    >`select e.status, e.signature_verified, e.normalized_type, j.kind
      from provider_events e join background_jobs j on j.idempotency_key = 'event:' || e.id::text
      where e.provider_event_id = ${(JSON.parse(body) as { id: string }).id}`;
    expect(row).toMatchObject({
      status: 'pending',
      signature_verified: true,
      normalized_type: 'payment.succeeded',
      kind: 'process_provider_event',
    });
  });

  it('acknowledges a repeated delivery as a duplicate without new rows', async () => {
    const body = JSON.stringify(stripeEvent());
    const headers = stripeHeaders(body);
    const first = await post('stripe', stripeConnectionId, body, headers);
    const second = await post('stripe', stripeConnectionId, body, headers);
    expect(first.json()).toMatchObject({ duplicate: false });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ received: true, duplicate: true });
    const [n] = await harness.sql<{ n: number }[]>`
      select count(*)::int as n from provider_events
      where provider_event_id = ${(JSON.parse(body) as { id: string }).id}`;
    expect(n?.n).toBe(1);
  });

  it('collapses 20 concurrent deliveries into one event and one job', async () => {
    const parsed = stripeEvent();
    const body = JSON.stringify(parsed);
    const headers = stripeHeaders(body);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => post('stripe', stripeConnectionId, body, headers)),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(
      results.filter((r) => r.json<{ duplicate: boolean }>().duplicate === false),
    ).toHaveLength(1);
    const [row] = await harness.sql<{ events: number; jobs: number }[]>`
      select count(distinct e.id)::int as events, count(j.id)::int as jobs
      from provider_events e left join background_jobs j on j.idempotency_key = 'event:' || e.id::text
      where e.provider_event_id = ${parsed.id}`;
    expect(row).toEqual({ events: 1, jobs: 1 });
  });

  it('rejects an invalid signature with no rows', async () => {
    const before = await counts(stripeConnectionId);
    const body = JSON.stringify(stripeEvent());
    const res = await post('stripe', stripeConnectionId, body, stripeHeaders(body, 'whsec_wrong'));
    expect(res.statusCode).toBe(400);
    const error = apiErrorSchema.parse(res.json()).error;
    expect(error).toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
      details: { reason: 'invalid_signature' },
    });
    expect(await counts(stripeConnectionId)).toEqual(before);
  });

  it('rejects a missing signature and a tampered body', async () => {
    const body = JSON.stringify(stripeEvent());
    const missing = await post('stripe', stripeConnectionId, body, {
      'content-type': 'application/json',
    });
    expect(missing.json()).toMatchObject({ error: { details: { reason: 'missing_signature' } } });
    const tampered = await post(
      'stripe',
      stripeConnectionId,
      body.replace('{', '{ '),
      stripeHeaders(body),
    );
    expect(tampered.statusCode).toBe(400);
  });

  it('rejects a stale timestamp', async () => {
    const before = await counts(stripeConnectionId);
    const body = JSON.stringify(stripeEvent());
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const res = await post(
      'stripe',
      stripeConnectionId,
      body,
      stripeHeaders(body, STRIPE_SECRET, stale),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { details: { reason: 'timestamp_out_of_tolerance' } },
    });
    expect(await counts(stripeConnectionId)).toEqual(before);
  });

  it('returns 404 for an unknown or disabled connection and creates nothing', async () => {
    const body = JSON.stringify(stripeEvent());
    const unknown = await post('stripe', randomUUID(), body, stripeHeaders(body));
    expect(unknown.statusCode).toBe(404);
    await harness.sql`update provider_connections set status = 'disabled' where id = ${paddleConnectionId}`;
    const paddleBody = JSON.stringify(paddleEvent());
    const disabled = await post(
      'paddle',
      paddleConnectionId,
      paddleBody,
      paddleHeaders(paddleBody),
    );
    expect(disabled.statusCode).toBe(404);
    await harness.sql`update provider_connections set status = 'unverified' where id = ${paddleConnectionId}`;
    expect(await counts(paddleConnectionId)).toEqual({ events: 0, jobs: 0 });
  });

  it('does not accept a Stripe event on a Paddle connection URL', async () => {
    const body = JSON.stringify(stripeEvent());
    const wrongProvider = await post('stripe', paddleConnectionId, body, stripeHeaders(body));
    expect(wrongProvider.statusCode).toBe(404);
    const wrongSignature = await post('paddle', paddleConnectionId, body, stripeHeaders(body));
    expect(wrongSignature.statusCode).toBe(400);
    expect(await counts(paddleConnectionId)).toEqual({ events: 0, jobs: 0 });
  });

  it('rejects oversize bodies with 413 before verification', async () => {
    const body = JSON.stringify({ ...stripeEvent(), pad: 'x'.repeat(300 * 1024) });
    const res = await post('stripe', stripeConnectionId, body, stripeHeaders(body));
    expect(res.statusCode).toBe(413);
  });

  it('accepts +json content types and charset parameters', async () => {
    const body = JSON.stringify(stripeEvent());
    const headers = { ...stripeHeaders(body), 'content-type': 'application/json; charset=utf-8' };
    expect((await post('stripe', stripeConnectionId, body, headers)).statusCode).toBe(200);
    const body2 = JSON.stringify(stripeEvent());
    const vendor = { ...stripeHeaders(body2), 'content-type': 'application/vnd.api+json' };
    expect((await post('stripe', stripeConnectionId, body2, vendor)).statusCode).toBe(200);
  });

  it('persists a valid Paddle event', async () => {
    const parsed = paddleEvent();
    const body = JSON.stringify(parsed);
    const res = await post('paddle', paddleConnectionId, body, paddleHeaders(body));
    expect(res.json()).toEqual({ received: true, duplicate: false });
    const [row] = await harness.sql<{ normalized_type: string; provider: string }[]>`
      select normalized_type, provider from provider_events
      where provider_event_id = ${parsed.event_id}`;
    expect(row).toMatchObject({ provider: 'paddle', normalized_type: 'payment.succeeded' });
  });

  it('persists unsupported event types as unsupported', async () => {
    const parsed = stripeEvent('unsupported-customer-created');
    const body = JSON.stringify(parsed);
    const res = await post('stripe', stripeConnectionId, body, stripeHeaders(body));
    expect(res.statusCode).toBe(200);
    const [row] = await harness.sql<{ normalized_type: string }[]>`
      select normalized_type from provider_events where provider_event_id = ${parsed.id}`;
    expect(row?.normalized_type).toBe('unsupported');
  });

  it('rejects live-mode events with 422 and persists nothing', async () => {
    const before = await counts(stripeConnectionId);
    const body = JSON.stringify(stripeEvent('livemode-payment-intent-succeeded'));
    const res = await post('stripe', stripeConnectionId, body, stripeHeaders(body));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'WEBHOOK_LIVE_MODE_REJECTED' } });
    expect(await counts(stripeConnectionId)).toEqual(before);
  });

  it('rejects a validly signed non-object payload without persisting', async () => {
    const before = await counts(stripeConnectionId);
    const body = JSON.stringify([1, 2]);
    const res = await post('stripe', stripeConnectionId, body, stripeHeaders(body));
    expect(res.statusCode).toBe(400);
    expect(await counts(stripeConnectionId)).toEqual(before);
  });

  it('verifies events signed with a rotated second secret', async () => {
    const owner = await harness.newUser();
    const org = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: owner.headers,
      payload: { name: 'Rotate', slug: `org-${randomUUID().slice(0, 12)}` },
    });
    const orgId = org.json<{ id: string }>().id;
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/connections`,
      headers: owner.headers,
      payload: {
        provider: 'stripe',
        mode: 'sandbox',
        displayName: 'r',
        externalAccountId: 'acct_rot',
        webhookSecrets: [STRIPE_SECRET],
      },
    });
    const id = created.json<{ id: string }>().id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}/connections/${id}`,
      headers: owner.headers,
      payload: { webhookSecret: SECOND_SECRET },
    });
    expect(patch.statusCode).toBe(200);
    const body = JSON.stringify(stripeEvent());
    expect((await post('stripe', id, body, stripeHeaders(body, SECOND_SECRET))).statusCode).toBe(
      200,
    );
    expect((await post('stripe', id, body, stripeHeaders(body, STRIPE_SECRET))).statusCode).toBe(
      200,
    );
    const third = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}/connections/${id}`,
      headers: owner.headers,
      payload: { webhookSecret: 'whsec_third' },
    });
    expect(third.statusCode).toBe(200);
    const body2 = JSON.stringify(stripeEvent());
    expect((await post('stripe', id, body2, stripeHeaders(body2, STRIPE_SECRET))).statusCode).toBe(
      400,
    );
    expect((await post('stripe', id, body2, stripeHeaders(body2, 'whsec_third'))).statusCode).toBe(
      200,
    );
  });
});
