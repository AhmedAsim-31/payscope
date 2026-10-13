import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { createAdapterRegistry } from '@payscope/provider-adapters/registry';
import { stripeAdapter } from '@payscope/provider-adapters/stripe/stripe-adapter';
import { createHarness, type TestUser } from '../test/identity-harness';
import { DEFAULT_POLICIES } from '../rate-limit/policies';

const GOOD_KEY = 'sk_test_good';

const harness = createHarness();
let app: FastifyInstance;
let owner: TestUser;
let orgId: string;

beforeAll(async () => {
  app = await harness.start({
    rateLimits: { ...DEFAULT_POLICIES, credentialTest: { max: 1000, windowSec: 60 } },
    adapters: createAdapterRegistry([
      {
        ...stripeAdapter,
        validateCredentials: (ctx) =>
          ctx.credentials.apiKey === GOOD_KEY
            ? Promise.resolve()
            : Promise.reject(
                new ProviderError('provider_auth', 'Invalid API key', { status: 401 }),
              ),
      },
    ]),
  });
  owner = await harness.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Verify', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  orgId = res.json<{ id: string }>().id;
});
afterAll(() => harness.stop());

async function createConnection(over: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/connections`,
    headers: owner.headers,
    payload: {
      provider: 'stripe',
      mode: 'sandbox',
      displayName: 'Stripe sandbox',
      externalAccountId: `acct_${randomUUID()}`,
      ...over,
    },
  });
  return res.json<{ id: string }>().id;
}

function verify(id: string, user: TestUser = owner) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/connections/${id}/verify`,
    headers: user.headers,
  });
}

describe('connection credential test', () => {
  it('marks a connection active with a verification time when the key works', async () => {
    const res = await verify(await createConnection({ apiKey: GOOD_KEY }));
    expect(res.statusCode).toBe(200);
    const view = res.json<{ status: string; lastVerifiedAt: string | null; lastError: null }>();
    expect(view).toMatchObject({ status: 'active', lastError: null });
    expect(view.lastVerifiedAt).not.toBeNull();
    expect(res.body).not.toContain(GOOD_KEY);
  });

  it('records a sanitized error and never a verification time when the key fails', async () => {
    const res = await verify(await createConnection({ apiKey: 'sk_test_bad' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'error', lastVerifiedAt: null });
    expect(res.json<{ lastError: string }>().lastError).toContain('Invalid API key');
  });

  it('refuses simulated connections, missing keys, and viewers', async () => {
    const simulated = await verify(await createConnection({ mode: 'simulation' }));
    expect(simulated.statusCode).toBe(409);
    expect(simulated.json()).toMatchObject({ error: { code: 'SIMULATED_CONNECTION' } });
    const keyless = await verify(await createConnection({}));
    expect(keyless.json()).toMatchObject({ error: { code: 'NO_API_KEY' } });

    const viewer = await harness.newUser();
    await app.inject({ url: '/api/v1/orgs', headers: viewer.headers });
    await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/members`,
      headers: owner.headers,
      payload: { email: viewer.email, role: 'VIEWER' },
    });
    expect((await verify(await createConnection({ apiKey: GOOD_KEY }), viewer)).statusCode).toBe(
      403,
    );
  });
});
