import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '@payscope/shared/api-error';
import { createHarness, type TestUser } from '../test/identity-harness';

const harness = createHarness();
let app: FastifyInstance;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(() => harness.stop());

const apiError = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json()).error;

async function createOrg(owner: TestUser) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: owner.headers,
    payload: { name: 'Acme', slug: `org-${randomUUID().slice(0, 12)}` },
  });
  return res.json<{ id: string }>().id;
}

async function addMember(owner: TestUser, orgId: string, role: string) {
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

const transfer = (actor: TestUser, orgId: string, userId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/members/${userId}/transfer-ownership`,
    headers: actor.headers,
  });

const roles = async (orgId: string) =>
  Object.fromEntries(
    (
      await harness.sql<{ user_id: string; role: string }[]>`
        select user_id, role from memberships where org_id = ${orgId}`
    ).map((r) => [r.user_id, r.role]),
  );

describe('ownership transfer', () => {
  it('makes the target the owner and the caller an admin, with one audit entry', async () => {
    const owner = await harness.newUser();
    const orgId = await createOrg(owner);
    const target = await addMember(owner, orgId, 'VIEWER');

    const res = await transfer(owner, orgId, target.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: target.id, role: 'OWNER' });
    expect(await roles(orgId)).toEqual({ [owner.id]: 'ADMIN', [target.id]: 'OWNER' });
    const audits = await harness.sql<
      { actor_id: string; target_id: string; outcome: string; previous_state: unknown }[]
    >`select actor_id, target_id, outcome, previous_state from audit_logs
      where org_id = ${orgId} and action = 'ownership.transfer'`;
    expect(audits).toEqual([
      {
        actor_id: owner.id,
        target_id: target.id,
        outcome: 'success',
        previous_state: { ownerId: owner.id, targetRole: 'VIEWER' },
      },
    ]);
  });

  it('forbids every non-owner role with 403', async () => {
    const owner = await harness.newUser();
    const orgId = await createOrg(owner);
    const target = await addMember(owner, orgId, 'VIEWER');
    for (const role of ['ADMIN', 'OPERATOR', 'VIEWER']) {
      const actor = await addMember(owner, orgId, role);
      const res = await transfer(actor, orgId, target.id);
      expect(res.statusCode).toBe(403);
    }
    expect((await roles(orgId))[owner.id]).toBe('OWNER');
  });

  it('rejects a self-transfer with 422', async () => {
    const owner = await harness.newUser();
    const orgId = await createOrg(owner);
    const res = await transfer(owner, orgId, owner.id);
    expect(res.statusCode).toBe(422);
    expect(apiError(res).code).toBe('SELF_TRANSFER');
  });

  it('rejects a non-member and a member of another org with 404, leaving both orgs untouched', async () => {
    const owner = await harness.newUser();
    const orgId = await createOrg(owner);
    const other = await harness.newUser();
    const otherOrg = await createOrg(other);
    const outsider = await addMember(other, otherOrg, 'VIEWER');

    expect((await transfer(owner, orgId, randomUUID())).statusCode).toBe(404);
    expect((await transfer(owner, orgId, outsider.id)).statusCode).toBe(404);
    expect((await transfer(owner, otherOrg, outsider.id)).statusCode).toBe(404);
    expect(await roles(orgId)).toEqual({ [owner.id]: 'OWNER' });
    expect(await roles(otherOrg)).toEqual({ [other.id]: 'OWNER', [outsider.id]: 'VIEWER' });
  });

  it('rejects a target who is already an owner with 409', async () => {
    const owner = await harness.newUser();
    const orgId = await createOrg(owner);
    const coOwner = await addMember(owner, orgId, 'OWNER');
    const res = await transfer(owner, orgId, coOwner.id);
    expect(res.statusCode).toBe(409);
    expect(apiError(res).code).toBe('ALREADY_OWNER');
  });

  it('lets exactly one of two concurrent transfers win', async () => {
    for (let i = 0; i < 5; i++) {
      const owner = await harness.newUser();
      const orgId = await createOrg(owner);
      const a = await addMember(owner, orgId, 'ADMIN');
      const b = await addMember(owner, orgId, 'VIEWER');

      const results = await Promise.all([
        transfer(owner, orgId, a.id),
        transfer(owner, orgId, b.id),
      ]);

      const [won, lost] = results.map((r) => r.statusCode).sort();
      expect(won).toBe(200);
      expect([403, 409]).toContain(lost);
      const after = await roles(orgId);
      expect(Object.values(after).filter((r) => r === 'OWNER')).toHaveLength(1);
      expect(after[owner.id]).toBe('ADMIN');
    }
  });
});
