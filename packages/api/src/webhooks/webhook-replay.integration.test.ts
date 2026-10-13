import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
const connections: Record<string, string> = {};

beforeAll(async () => {
  app = await harness.start();
  const owner = await harness.newUser();
  const org = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Replay', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const orgId = org.json<{ id: string }>().id;
  for (const [provider, secret] of [
    ['stripe', STRIPE_SECRET],
    ['paddle', PADDLE_SECRET],
  ] as const) {
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
    connections[provider] = res.json<{ id: string }>().id;
  }
});
afterAll(() => harness.stop());

const nowSeconds = () => Math.floor(Date.now() / 1000);

const providers = [
  {
    name: 'stripe',
    build: () => {
      const event = stripeEvent();
      return { body: JSON.stringify(event), eventId: event.id };
    },
    sign: (body: string, ts: number) => stripeHeaders(body, STRIPE_SECRET, ts),
  },
  {
    name: 'paddle',
    build: () => {
      const event = paddleEvent();
      return { body: JSON.stringify(event), eventId: event.event_id };
    },
    sign: (body: string, ts: number) => paddleHeaders(body, PADDLE_SECRET, ts),
  },
];

describe.each(providers)('$name webhook replay protection', ({ name, build, sign }) => {
  const send = (body: string, headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: `/webhooks/${name}/${connections[name]}`,
      headers,
      payload: body,
    });
  const rows = async (eventId: string) => {
    const [row] = await harness.sql<{ n: number }[]>`
      select count(*)::int as n from provider_events where provider_event_id = ${eventId}`;
    return row?.n;
  };

  it('dedupes an identical replay inside the tolerance window', async () => {
    const { body, eventId } = build();
    const headers = sign(body, nowSeconds());
    expect((await send(body, headers)).json()).toMatchObject({ duplicate: false });
    const replay = await send(body, headers);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ received: true, duplicate: true });
    expect(await rows(eventId)).toBe(1);
  });

  it.each([3600, -3600])(
    'rejects a validly signed replay with a timestamp %is off, even for a stored event',
    async (offset) => {
      const { body, eventId } = build();
      expect((await send(body, sign(body, nowSeconds()))).statusCode).toBe(200);
      const replay = await send(body, sign(body, nowSeconds() - offset));
      expect(replay.statusCode).toBe(400);
      expect(replay.json()).toMatchObject({
        error: { details: { reason: 'timestamp_out_of_tolerance' } },
      });
      expect(await rows(eventId)).toBe(1);
    },
  );

  it('persists nothing for a never-seen event replayed outside tolerance', async () => {
    const { body, eventId } = build();
    const res = await send(body, sign(body, nowSeconds() - 3600));
    expect(res.statusCode).toBe(400);
    expect(await rows(eventId)).toBe(0);
  });
});
