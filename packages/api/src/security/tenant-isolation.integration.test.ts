import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ROLES, can, type Action } from '@payscope/shared/permissions';
import { createHarness } from '../test/identity-harness';
import { UNLIMITED_RATE_LIMITS, registeredRoutes, seedTenant, type Tenant } from './tenant-fixture';

const harness = createHarness();
const { sql } = harness;
let app: FastifyInstance;
let a: Tenant;
let b: Tenant;

const PREFIX = '/api/v1/orgs/:orgId';

const RESOURCE_PARAMS = [
  'paymentId',
  'subscriptionId',
  'customerId',
  'connectionId',
  'entitlementId',
  'eventId',
  'runId',
  'findingId',
  'incidentId',
  'scenarioId',
] as const;

const SOME_ID = '00000000-0000-4000-8000-000000000001';
const REASON = 'Checked against the provider dashboard';

const BODIES: Record<string, unknown> = {
  'POST /members': { email: 'nobody@example.test', role: 'VIEWER' },
  'PATCH /members/:userId': { role: 'VIEWER' },
  'DELETE /members/:userId': undefined,
  'POST /members/:userId/transfer-ownership': undefined,
  'POST /connections': {
    provider: 'stripe',
    mode: 'sandbox',
    displayName: 'x',
    externalAccountId: 'acct_matrix',
  },
  'PATCH /connections/:connectionId': { webhookSecret: 'matrix-test-value-0001' },
  'POST /connections/:connectionId/verify': undefined,
  'DELETE /connections/:connectionId/credentials/:credential': undefined,
  'POST /events/:eventId/retry': undefined,
  'POST /reconciliation/runs': { mode: 'local' },
  'PATCH /reconciliation/findings/:findingId': { status: 'reviewed', note: 'n' },
  'POST /incidents/:incidentId/actions': { action: 'note', note: 'n' },
  'POST /entitlements': {
    customerId: SOME_ID,
    entitlementKey: 'pro',
    state: 'active',
    observedAt: '2026-01-01T00:00:00Z',
  },
  'POST /repairs/reprocess-event': { eventId: SOME_ID, reason: REASON },
  'POST /repairs/correct-entitlement': { findingId: SOME_ID, reason: REASON },
  'POST /repairs/resolve-finding': { findingId: SOME_ID, reason: REASON },
  'POST /repairs/refresh-from-provider': { paymentId: SOME_ID, reason: REASON },
  'POST /scenarios/:scenarioId/run': undefined,
  'POST /scenarios/reset': undefined,
};

/** Retry is a conditional write scoped by org; unknown and foreign ids both yield 409, never a hint of existence. */
const FOREIGN_ID_STATUS: Record<string, number> = { 'POST /events/:eventId/retry': 409 };

const MUTATION_ACTIONS: Record<string, Action> = {
  'POST /members': 'members:manage',
  'PATCH /members/:userId': 'members:manage',
  'DELETE /members/:userId': 'members:manage',
  'POST /members/:userId/transfer-ownership': 'ownership:transfer',
  'POST /connections': 'connections:manage',
  'PATCH /connections/:connectionId': 'connections:manage',
  'POST /connections/:connectionId/verify': 'connections:manage',
  'DELETE /connections/:connectionId/credentials/:credential': 'connections:manage',
  'POST /events/:eventId/retry': 'jobs:retry',
  'POST /reconciliation/runs': 'reconciliation:run',
  'PATCH /reconciliation/findings/:findingId': 'findings:update',
  'POST /incidents/:incidentId/actions': 'findings:update',
  'POST /entitlements': 'entitlements:ingest',
  'POST /repairs/reprocess-event': 'repairs:execute',
  'POST /repairs/correct-entitlement': 'repairs:execute',
  'POST /repairs/resolve-finding': 'repairs:execute',
  'POST /repairs/refresh-from-provider': 'repairs:execute',
  'POST /scenarios/:scenarioId/run': 'scenarios:run',
  'POST /scenarios/reset': 'scenarios:run',
};

type Spec = { method: string; suffix: string; key: string; params: string[] };

function orgRoutes(): Spec[] {
  return registeredRoutes(app)
    .filter((r) => r.path.startsWith(PREFIX))
    .map((r) => {
      const suffix = r.path.slice(PREFIX.length);
      const params = [...suffix.matchAll(/:(\w+)/g)].map((m) => m[1] ?? '');
      return { method: r.method, suffix, key: `${r.method} ${suffix}`, params };
    });
}

function fill(spec: Spec, orgId: string, values: Record<string, string>) {
  const path = spec.suffix.replace(/:(\w+)/g, (_, name: string) => values[name] ?? name);
  return `/api/v1/orgs/${orgId}${path}`;
}

function send(
  spec: Spec,
  orgId: string,
  values: Record<string, string>,
  headers?: { authorization: string },
) {
  const idempotency =
    spec.suffix.startsWith('/repairs/') || spec.key === 'POST /entitlements'
      ? { 'idempotency-key': randomUUID() }
      : undefined;
  const body = BODIES[spec.key];
  return app.inject({
    method: spec.method as 'GET',
    url: fill(spec, orgId, values),
    headers: { ...headers, ...idempotency },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}

const resourceValues = (t: Tenant): Record<string, string> => ({
  ...t.ids,
  userId: t.users.OWNER.id,
  credential: 'apiKey',
});

beforeAll(async () => {
  app = await harness.start({ rateLimits: UNLIMITED_RATE_LIMITS });
  a = await seedTenant(harness, app);
  b = await seedTenant(harness, app);
});
afterAll(() => harness.stop());

describe('route matrix', () => {
  it('knows every registered org-scoped route', () => {
    const routes = orgRoutes();
    expect(routes.length).toBeGreaterThan(25);
    const unknownParams = routes.flatMap((r) =>
      r.params.filter(
        (p) =>
          p !== 'userId' &&
          p !== 'credential' &&
          !(RESOURCE_PARAMS as readonly string[]).includes(p),
      ),
    );
    expect(unknownParams).toEqual([]);
    const mutations = routes.filter((r) => r.method !== 'GET').map((r) => r.key);
    expect(mutations.filter((k) => !(k in BODIES))).toEqual([]);
    expect(mutations.filter((k) => !(k in MUTATION_ACTIONS))).toEqual([]);
  });

  it('returns 401 without a token on every route', async () => {
    const failures: string[] = [];
    for (const spec of orgRoutes()) {
      const res = await send(spec, a.orgId, resourceValues(a));
      if (res.statusCode !== 401) failures.push(`${spec.key} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('returns 404 to a member of another org on every route', async () => {
    const failures: string[] = [];
    for (const spec of orgRoutes()) {
      const res = await send(spec, a.orgId, resourceValues(a), b.users.OWNER.headers);
      if (res.statusCode !== 404) failures.push(`${spec.key} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("returns 404 when another org's resource id is used under own orgId", async () => {
    const failures: string[] = [];
    // scenarioId is a global catalog id, not a tenant-owned resource
    for (const spec of orgRoutes().filter((r) => r.params.some((p) => p !== 'scenarioId'))) {
      const res = await send(spec, b.orgId, resourceValues(a), b.users.OWNER.headers);
      const expected = FOREIGN_ID_STATUS[spec.key] ?? 404;
      if (res.statusCode !== expected) failures.push(`${spec.key} -> ${res.statusCode}`);
      if (expected !== 404) {
        const unknown = Object.fromEntries(spec.params.map((p) => [p, randomUUID()]));
        const control = await send(spec, b.orgId, unknown, b.users.OWNER.headers);
        if (control.statusCode !== res.statusCode) failures.push(`${spec.key} reveals existence`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('left org A untouched by every cross-tenant mutation attempt', async () => {
    const [runs] = await sql<{ n: number }[]>`
      select count(*)::int as n from reconciliation_runs where org_id = ${a.orgId}`;
    const [conns] = await sql<{ n: number }[]>`
      select count(*)::int as n from provider_connections where org_id = ${a.orgId}`;
    const [members] = await sql<{ n: number }[]>`
      select count(*)::int as n from memberships where org_id = ${a.orgId}`;
    expect([runs?.n, conns?.n, members?.n]).toEqual([1, 1, 4]);
  });
});

describe('role matrix', () => {
  it('enforces the shared permissions matrix on every mutation route', async () => {
    const failures: string[] = [];
    const values = { ...resourceValues(a), userId: randomUUID() };
    for (const spec of orgRoutes().filter((r) => r.method !== 'GET')) {
      const action = MUTATION_ACTIONS[spec.key];
      if (!action) continue;
      for (const role of ROLES) {
        const res = await send(spec, a.orgId, values, a.users[role].headers);
        const allowed = can(role, action);
        const ok = allowed
          ? res.statusCode !== 403 && res.statusCode < 500
          : res.statusCode === 403;
        if (!ok) failures.push(`${role} ${spec.key} -> ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('body orgId is ignored', () => {
  const count = async (table: 'reconciliation_runs' | 'provider_connections', orgId: string) => {
    const [row] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from ${table} where org_id = $1`,
      [orgId],
    );
    return row?.n ?? 0;
  };

  it('creates connections and runs in the path org, never the body org', async () => {
    const before = {
      connA: await count('provider_connections', a.orgId),
      runsA: await count('reconciliation_runs', a.orgId),
      connB: await count('provider_connections', b.orgId),
      runsB: await count('reconciliation_runs', b.orgId),
    };
    const headers = b.users.OWNER.headers;
    const conn = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${b.orgId}/connections`,
      headers,
      payload: { ...(BODIES['POST /connections'] as object), orgId: a.orgId },
    });
    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${b.orgId}/reconciliation/runs`,
      headers,
      payload: { mode: 'local', orgId: a.orgId },
    });
    expect([conn.statusCode, run.statusCode]).toEqual([201, 202]);
    expect(await count('provider_connections', a.orgId)).toBe(before.connA);
    expect(await count('reconciliation_runs', a.orgId)).toBe(before.runsA);
    expect(await count('provider_connections', b.orgId)).toBe(before.connB + 1);
    expect(await count('reconciliation_runs', b.orgId)).toBe(before.runsB + 1);
  });

  it('adds members to the path org even when the body names another org', async () => {
    const newcomer = await harness.newUser();
    await app.inject({ url: '/api/v1/orgs', headers: newcomer.headers });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${b.orgId}/members`,
      headers: b.users.OWNER.headers,
      payload: { email: newcomer.email, role: 'VIEWER', orgId: a.orgId },
    });
    expect(res.statusCode).toBe(201);
    const rows = await sql<{ org_id: string }[]>`
      select org_id from memberships where user_id = ${newcomer.id}`;
    expect(rows.map((r) => r.org_id)).toEqual([b.orgId]);
  });

  it('does not let a body orgId unlock another org', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${a.orgId}/connections`,
      headers: b.users.OWNER.headers,
      payload: { ...(BODIES['POST /connections'] as object), orgId: b.orgId },
    });
    expect(res.statusCode).toBe(404);
  });
});
