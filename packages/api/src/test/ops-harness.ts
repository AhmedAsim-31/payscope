import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import { createRunReconciliationHandler } from '../jobs/handlers/run-reconciliation';
import { registry, silent } from './event-harness';
import { TEST_CREDENTIALS_KEY, type createHarness, type TestUser } from './identity-harness';
import { reconJob, seedConnection, type Org } from './reconciliation-fixtures';

type Harness = ReturnType<typeof createHarness>;
export type Tenant = Org & { owner: TestUser };

const handler = createRunReconciliationHandler(
  registry,
  createCredentialsCipher(TEST_CREDENTIALS_KEY),
  { batchSize: 50 },
);

export async function newTenant(h: Harness, app: FastifyInstance): Promise<Tenant> {
  const owner = await h.newUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Ops', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  const org = await seedConnection(h.sql, res.json<{ id: string }>().id, false);
  return { ...org, owner };
}

export async function addMemberWithRole(
  h: Harness,
  app: FastifyInstance,
  t: Tenant,
  role: string,
): Promise<TestUser> {
  const user = await h.newUser();
  await app.inject({ url: '/api/v1/orgs', headers: user.headers });
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/members`,
    headers: t.owner.headers,
    payload: { email: user.email, role },
  });
  if (res.statusCode !== 201) throw new Error(`could not add ${role}: ${res.body}`);
  return user;
}

export async function runLocalRecon(h: Harness, app: FastifyInstance, t: Tenant): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/reconciliation/runs`,
    headers: t.owner.headers,
    payload: { mode: 'local' },
  });
  if (res.statusCode !== 202) throw new Error(`run not started: ${res.body}`);
  const { id } = res.json<{ id: string }>();
  await handler(reconJob(t.orgId, id), { db: h.db, logger: silent, workerId: 'test' });
}

export function repairCall(
  app: FastifyInstance,
  t: Tenant,
  user: TestUser,
  path: string,
  body: object,
  key: string | undefined = randomUUID(),
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${t.orgId}/repairs/${path}`,
    headers: { ...user.headers, ...(key ? { 'idempotency-key': key } : {}) },
    payload: body,
  });
}

export async function findingIdOf(h: Harness, t: Tenant, type: string): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    select id from reconciliation_findings where org_id = ${t.orgId} and type = ${type}::finding_type
    order by created_at desc limit 1`;
  if (!row) throw new Error(`no ${type} finding`);
  return row.id;
}

export const REASON = 'Verified against the provider dashboard';
