import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import {
  DEFAULT_POLICIES,
  POLICY_DEFS,
  POLICY_NAMES,
  policyEnvPrefix,
  rateLimitEnvSchema,
  rateLimitKey,
  resolvePolicies,
  type PolicyName,
} from './policies';

const USER = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333';

async function keyFor(
  name: PolicyName,
  ctx: { user?: string; org?: string; ip?: string; connectionId?: string; trustProxy?: boolean },
) {
  const app = Fastify({ trustProxy: ctx.trustProxy ?? false });
  app.get('/x/:connectionId', (request) => {
    if (ctx.user)
      request.auth = { userId: ctx.user, email: undefined, role: undefined, sessionId: undefined };
    if (ctx.org) request.org = { id: ctx.org, role: 'OWNER' };
    return { key: rateLimitKey(name, request) };
  });
  const res = await app.inject({
    method: 'GET',
    url: `/x/${ctx.connectionId ?? 'nope'}`,
    remoteAddress: ctx.ip ?? '10.0.0.1',
    headers: { 'x-forwarded-for': '9.9.9.9' },
  });
  await app.close();
  return res.json<{ key: string }>().key;
}

describe('policy defaults', () => {
  it('matches the documented limits', () => {
    expect(DEFAULT_POLICIES.authenticatedRead).toEqual({ max: 300, windowSec: 60 });
    expect(DEFAULT_POLICIES.authenticatedWrite).toEqual({ max: 60, windowSec: 60 });
    expect(DEFAULT_POLICIES.credentialTest).toEqual({ max: 5, windowSec: 60 });
    expect(DEFAULT_POLICIES.webhookIngress).toEqual({ max: 600, windowSec: 60 });
    expect(DEFAULT_POLICIES.webhookIngressIp).toEqual({ max: 1200, windowSec: 60 });
    expect(DEFAULT_POLICIES.internalTick).toEqual({ max: 30, windowSec: 60 });
    expect(DEFAULT_POLICIES.reconciliationRun).toEqual({ max: 5, windowSec: 600 });
    expect(DEFAULT_POLICIES.scenarioRun).toEqual({ max: 20, windowSec: 600 });
    expect(DEFAULT_POLICIES.repairAction).toEqual({ max: 30, windowSec: 600 });
    expect(DEFAULT_POLICIES.search).toEqual({ max: 60, windowSec: 60 });
  });

  it('derives env var prefixes from policy names', () => {
    expect(policyEnvPrefix('credentialTest')).toBe('RATE_LIMIT_CREDENTIAL_TEST');
    expect(policyEnvPrefix('search')).toBe('RATE_LIMIT_SEARCH');
  });
});

describe('resolvePolicies', () => {
  it('overrides only the named fields', () => {
    const parsed = rateLimitEnvSchema.parse({
      RATE_LIMIT_SEARCH_MAX: '7',
      RATE_LIMIT_AUTHENTICATED_WRITE_WINDOW_SEC: '1',
    });
    const resolved = resolvePolicies(parsed);
    expect(resolved.search).toEqual({ max: 7, windowSec: 60 });
    expect(resolved.authenticatedWrite).toEqual({ max: 60, windowSec: 1 });
    expect(resolved.authenticatedRead).toEqual(DEFAULT_POLICIES.authenticatedRead);
  });

  it('rejects zero, negative, and non-integer values', () => {
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      expect(rateLimitEnvSchema.safeParse({ RATE_LIMIT_SEARCH_MAX: bad }).success).toBe(false);
    }
  });
});

describe('rateLimitKey', () => {
  it('keys user-scoped policies by user id', async () => {
    expect(await keyFor('authenticatedRead', { user: USER })).toBe(
      `authenticatedRead:user:${USER}`,
    );
  });

  it('keys user+org policies by both and org policies by org', async () => {
    expect(await keyFor('credentialTest', { user: USER, org: ORG })).toBe(
      `credentialTest:user:${USER}:org:${ORG}`,
    );
    expect(await keyFor('reconciliationRun', { user: USER, org: ORG })).toBe(
      `reconciliationRun:org:${ORG}`,
    );
  });

  it('keys webhook ingress by connection id', async () => {
    expect(await keyFor('webhookIngress', { connectionId: CONNECTION })).toBe(
      `webhookIngress:connection:${CONNECTION}`,
    );
  });

  it('falls back to the ip when identity is missing or the connection id is not a uuid', async () => {
    expect(await keyFor('authenticatedWrite', {})).toBe('authenticatedWrite:ip:10.0.0.1');
    expect(await keyFor('credentialTest', { user: USER })).toBe('credentialTest:ip:10.0.0.1');
    expect(await keyFor('webhookIngress', {})).toBe('webhookIngress:ip:10.0.0.1');
  });

  it('ignores x-forwarded-for unless the proxy is trusted', async () => {
    expect(await keyFor('internalTick', {})).toBe('internalTick:ip:10.0.0.1');
    expect(await keyFor('internalTick', { trustProxy: true })).toBe('internalTick:ip:9.9.9.9');
  });

  it('covers every policy', () => {
    expect(POLICY_NAMES).toEqual(Object.keys(POLICY_DEFS));
  });
});
