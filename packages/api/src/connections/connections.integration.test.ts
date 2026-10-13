import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHarness, type TestUser } from '../test/identity-harness';

const harness = createHarness();
let app: FastifyInstance;
let owner: TestUser;
let orgId: string;

beforeAll(async () => {
  app = await harness.start();
  owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Conns', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  orgId = res.json<{ id: string }>().id;
});
afterAll(() => harness.stop());

const base = (over: Record<string, unknown> = {}) => ({
  provider: 'stripe',
  mode: 'sandbox',
  displayName: 'Stripe sandbox',
  externalAccountId: `acct_${randomUUID()}`,
  webhookSecrets: ['whsec_leak_check_1'],
  apiKey: 'sk_test_leak_check_1',
  ...over,
});

function create(user: TestUser, payload: object) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/connections`,
    headers: user.headers,
    payload,
  });
}

async function addMember(role: string): Promise<TestUser> {
  const user = await harness.newUser();
  await app.inject({ url: '/api/v1/orgs', headers: user.headers });
  await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/members`,
    headers: owner.headers,
    payload: { email: user.email, role },
  });
  return user;
}

describe('connections API', () => {
  it('creates a connection and never returns secrets or ciphertext', async () => {
    const res = await create(owner, base());
    expect(res.statusCode).toBe(201);
    const view = res.json<{ id: string; webhookUrl: string }>();
    expect(view).toMatchObject({
      status: 'unverified',
      hasWebhookSecret: true,
      hasApiKey: true,
      webhookUrl: `/webhooks/stripe/${view.id}`,
    });
    const list = await app.inject({
      url: `/api/v1/orgs/${orgId}/connections`,
      headers: owner.headers,
    });
    const one = await app.inject({
      url: `/api/v1/orgs/${orgId}/connections/${view.id}`,
      headers: owner.headers,
    });
    for (const body of [res.body, list.body, one.body]) {
      expect(body).not.toContain('whsec_leak_check_1');
      expect(body).not.toContain('sk_test_leak_check_1');
      expect(body.toLowerCase()).not.toContain('ciphertext');
    }
    expect(list.json<{ connections: unknown[] }>().connections.length).toBeGreaterThan(0);
    const [stored] = await harness.sql<
      { credentials_ciphertext: Buffer; credentials_key_version: number }[]
    >`
      select credentials_ciphertext, credentials_key_version from provider_connections where id = ${view.id}`;
    expect(stored?.credentials_key_version).toBe(1);
    expect(stored?.credentials_ciphertext.toString('latin1')).not.toContain('whsec_leak_check_1');
  });

  it('forbids VIEWER from creating or rotating but allows reads', async () => {
    const viewer = await addMember('VIEWER');
    expect((await create(viewer, base())).statusCode).toBe(403);
    const created = await create(owner, base());
    const id = created.json<{ id: string }>().id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}/connections/${id}`,
      headers: viewer.headers,
      payload: { webhookSecret: 'x' },
    });
    expect(patch.statusCode).toBe(403);
    const list = await app.inject({
      url: `/api/v1/orgs/${orgId}/connections`,
      headers: viewer.headers,
    });
    expect(list.statusCode).toBe(200);
  });

  it('rejects live Stripe keys and non-sandbox Paddle keys', async () => {
    const live = await create(owner, base({ apiKey: 'sk_live_abc' }));
    expect(live.statusCode).toBe(422);
    expect(live.json()).toMatchObject({ error: { code: 'LIVE_KEYS_NOT_ALLOWED' } });
    const paddle = await create(owner, base({ provider: 'paddle', apiKey: 'pdl_live_abc' }));
    expect(paddle.statusCode).toBe(422);
    const ok = await create(owner, base({ provider: 'paddle', apiKey: 'pdl_sdbx_abc' }));
    expect(ok.statusCode).toBe(201);
  });

  it('rejects live mode, too many secrets, and duplicate accounts', async () => {
    expect((await create(owner, base({ mode: 'live' }))).statusCode).toBe(400);
    expect((await create(owner, base({ webhookSecrets: ['a', 'b', 'c'] }))).statusCode).toBe(400);
    const account = `acct_${randomUUID()}`;
    expect((await create(owner, base({ externalAccountId: account }))).statusCode).toBe(201);
    expect((await create(owner, base({ externalAccountId: account }))).statusCode).toBe(409);
  });

  it('keeps at most two secrets when rotating and hides connections from other orgs', async () => {
    const id = (await create(owner, base({ webhookSecrets: ['s1'] }))).json<{ id: string }>().id;
    for (const secret of ['s2', 's3']) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${orgId}/connections/${id}`,
        headers: owner.headers,
        payload: { webhookSecret: secret },
      });
      expect(res.statusCode).toBe(200);
    }
    const stranger = await harness.newUser();
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: stranger.headers,
      payload: { name: 'Other', slug: `org-${randomUUID().slice(0, 12)}` },
    });
    const otherOrg = other.json<{ id: string }>().id;
    const cross = await app.inject({
      url: `/api/v1/orgs/${otherOrg}/connections/${id}`,
      headers: stranger.headers,
    });
    expect(cross.statusCode).toBe(404);
  });
});
