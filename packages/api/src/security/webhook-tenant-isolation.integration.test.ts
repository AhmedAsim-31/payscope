import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness } from '../test/identity-harness';
import { STRIPE_SECRET, stripeEvent, stripeHeaders } from '../test/webhook-fixtures';
import { UNLIMITED_RATE_LIMITS } from './tenant-fixture';

const harness = createHarness();
let app: FastifyInstance;

async function orgWithStripeConnection(secret: string) {
  const owner = await harness.newUser();
  const org = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Hook', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const orgId = org.json<{ id: string }>().id;
  const conn = await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/connections`,
    headers: owner.headers,
    payload: {
      provider: 'stripe',
      mode: 'sandbox',
      displayName: 'Stripe',
      externalAccountId: `acct_${randomUUID()}`,
      webhookSecrets: [secret],
    },
  });
  return { orgId, connectionId: conn.json<{ id: string }>().id };
}

const eventCount = async (orgIds: string[]) => {
  const [row] = await harness.sql<{ n: number }[]>`
    select count(*)::int as n from provider_events where org_id in ${harness.sql(orgIds)}`;
  return row?.n ?? 0;
};

beforeAll(async () => {
  app = await harness.start({ rateLimits: UNLIMITED_RATE_LIMITS });
});
afterAll(() => harness.stop());

it("rejects an event signed for org A's connection when posted to org B's URL", async () => {
  const a = await orgWithStripeConnection(STRIPE_SECRET);
  const b = await orgWithStripeConnection('whsec_test_other_org_secret');
  const body = JSON.stringify(stripeEvent());
  const headers = stripeHeaders(body, STRIPE_SECRET);

  const crossPost = await app.inject({
    method: 'POST',
    url: `/webhooks/stripe/${b.connectionId}`,
    headers,
    payload: body,
  });
  expect(crossPost.statusCode).toBe(400);
  expect(await eventCount([a.orgId, b.orgId])).toBe(0);

  const ownPost = await app.inject({
    method: 'POST',
    url: `/webhooks/stripe/${a.connectionId}`,
    headers,
    payload: body,
  });
  expect(ownPost.statusCode).toBe(200);
  expect(await eventCount([b.orgId])).toBe(0);
  expect(await eventCount([a.orgId])).toBe(1);
});
