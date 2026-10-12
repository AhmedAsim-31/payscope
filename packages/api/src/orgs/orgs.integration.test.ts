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

function apiError(res: { json: () => unknown }) {
  return apiErrorSchema.parse(res.json()).error;
}

const slug = () => `org-${randomUUID().slice(0, 12)}`;

async function register(user: TestUser) {
  await app.inject({ url: '/api/v1/orgs', headers: user.headers });
}

async function createOrg(user: TestUser, body: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: user.headers,
    payload: { name: 'Acme', slug: slug(), ...body },
  });
  return { res, id: res.json<{ id: string }>().id };
}

async function addMember(actor: TestUser, orgId: string, target: TestUser, role: string) {
  await register(target);
  return app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/members`,
    headers: actor.headers,
    payload: { email: target.email, role },
  });
}

function patchRole(actor: TestUser, orgId: string, userId: string, role: string) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/orgs/${orgId}/members/${userId}`,
    headers: actor.headers,
    payload: { role },
  });
}

function removeMember(actor: TestUser, orgId: string, userId: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/orgs/${orgId}/members/${userId}`,
    headers: actor.headers,
  });
}

describe('organizations', () => {
  it('requires authentication', async () => {
    expect((await app.inject('/api/v1/orgs')).statusCode).toBe(401);
  });

  it('makes the creator an OWNER and upserts their profile', async () => {
    const owner = await harness.newUser();
    const { res, id } = await createOrg(owner);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Acme', role: 'OWNER' });
    const [profile] = await harness.sql<
      { email: string }[]
    >`select email from profiles where id = ${owner.id}`;
    expect(profile?.email).toBe(owner.email);
    const get = await app.inject({ url: `/api/v1/orgs/${id}`, headers: owner.headers });
    expect(get.json()).toMatchObject({ id, role: 'OWNER' });
  });

  it('lists only the caller organizations', async () => {
    const a = await harness.newUser();
    const b = await harness.newUser();
    const { id: orgA } = await createOrg(a);
    const { id: orgB } = await createOrg(b);
    const listA = await app.inject({ url: '/api/v1/orgs', headers: a.headers });
    const ids = listA.json<{ orgs: { id: string }[] }>().orgs.map((o) => o.id);
    expect(ids).toContain(orgA);
    expect(ids).not.toContain(orgB);
  });

  it('returns 404 to a non-member without leaking existence', async () => {
    const owner = await harness.newUser();
    const stranger = await harness.newUser();
    const { id } = await createOrg(owner);
    const existing = await app.inject({ url: `/api/v1/orgs/${id}`, headers: stranger.headers });
    const missing = await app.inject({
      url: `/api/v1/orgs/${randomUUID()}`,
      headers: stranger.headers,
    });
    expect(existing.statusCode).toBe(404);
    expect(apiError(existing).code).toBe('NOT_FOUND');
    expect(apiError(missing).message).toBe(apiError(existing).message);
  });

  it('rejects a duplicate slug with 409 CONFLICT', async () => {
    const owner = await harness.newUser();
    const s = slug();
    await createOrg(owner, { slug: s });
    const { res } = await createOrg(owner, { slug: s });
    expect(res.statusCode).toBe(409);
    expect(apiError(res).code).toBe('CONFLICT');
  });

  it('rejects an invalid slug', async () => {
    const owner = await harness.newUser();
    const { res } = await createOrg(owner, { slug: 'Bad Slug!' });
    expect(res.statusCode).toBe(400);
  });

  it('ignores an orgId in the body', async () => {
    const owner = await harness.newUser();
    const other = await harness.newUser();
    const { id: otherOrg } = await createOrg(other);
    const { res, id } = await createOrg(owner, { orgId: otherOrg });
    expect(res.statusCode).toBe(201);
    expect(id).not.toBe(otherOrg);
    const members = await harness.sql<
      { user_id: string }[]
    >`select user_id from memberships where org_id = ${otherOrg}`;
    expect(members.map((m) => m.user_id)).toEqual([other.id]);
  });
});

describe('members and permissions', () => {
  it('lists members with email and role', async () => {
    const owner = await harness.newUser();
    const { id } = await createOrg(owner);
    const res = await app.inject({ url: `/api/v1/orgs/${id}/members`, headers: owner.headers });
    expect(res.json()).toEqual({
      members: [{ userId: owner.id, email: owner.email, displayName: null, role: 'OWNER' }],
    });
  });

  it('forbids a VIEWER from adding a member', async () => {
    const owner = await harness.newUser();
    const viewer = await harness.newUser();
    const target = await harness.newUser();
    const { id } = await createOrg(owner);
    expect((await addMember(owner, id, viewer, 'VIEWER')).statusCode).toBe(201);
    const res = await addMember(viewer, id, target, 'VIEWER');
    expect(res.statusCode).toBe(403);
    expect(apiError(res).code).toBe('FORBIDDEN');
  });

  it('lets a VIEWER read members', async () => {
    const owner = await harness.newUser();
    const viewer = await harness.newUser();
    const { id } = await createOrg(owner);
    await addMember(owner, id, viewer, 'VIEWER');
    const res = await app.inject({ url: `/api/v1/orgs/${id}/members`, headers: viewer.headers });
    expect(res.statusCode).toBe(200);
  });

  it('forbids an ADMIN from granting OWNER but lets an OWNER do it', async () => {
    const owner = await harness.newUser();
    const admin = await harness.newUser();
    const target = await harness.newUser();
    const { id } = await createOrg(owner);
    await addMember(owner, id, admin, 'ADMIN');
    expect((await addMember(admin, id, target, 'OWNER')).statusCode).toBe(403);
    expect((await addMember(admin, id, target, 'VIEWER')).statusCode).toBe(201);
    expect((await patchRole(admin, id, target.id, 'OWNER')).statusCode).toBe(403);
    expect((await patchRole(owner, id, target.id, 'OWNER')).statusCode).toBe(200);
  });

  it('forbids an ADMIN from demoting or removing an OWNER', async () => {
    const owner = await harness.newUser();
    const admin = await harness.newUser();
    const { id } = await createOrg(owner);
    await addMember(owner, id, admin, 'ADMIN');
    expect((await patchRole(admin, id, owner.id, 'VIEWER')).statusCode).toBe(403);
    expect((await removeMember(admin, id, owner.id)).statusCode).toBe(403);
  });

  it('returns 404 when the target has no profile and 409 for a duplicate member', async () => {
    const owner = await harness.newUser();
    const member = await harness.newUser();
    const { id } = await createOrg(owner);
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${id}/members`,
      headers: owner.headers,
      payload: { email: 'nobody@example.test', role: 'VIEWER' },
    });
    expect(unknown.statusCode).toBe(404);
    await addMember(owner, id, member, 'VIEWER');
    const dup = await addMember(owner, id, member, 'VIEWER');
    expect(dup.statusCode).toBe(409);
    expect(apiError(dup).code).toBe('CONFLICT');
  });

  it('returns 404 when changing a user who is not a member', async () => {
    const owner = await harness.newUser();
    const { id } = await createOrg(owner);
    expect((await patchRole(owner, id, randomUUID(), 'VIEWER')).statusCode).toBe(404);
  });
});

describe('last-owner guard', () => {
  it('rejects demoting or removing the only owner with 409 LAST_OWNER', async () => {
    const owner = await harness.newUser();
    const { id } = await createOrg(owner);
    const demote = await patchRole(owner, id, owner.id, 'ADMIN');
    expect(demote.statusCode).toBe(409);
    expect(apiError(demote).code).toBe('LAST_OWNER');
    const leave = await removeMember(owner, id, owner.id);
    expect(leave.statusCode).toBe(409);
    expect(apiError(leave).code).toBe('LAST_OWNER');
  });

  it('lets one of two owners leave', async () => {
    const owner = await harness.newUser();
    const second = await harness.newUser();
    const { id } = await createOrg(owner);
    await addMember(owner, id, second, 'OWNER');
    expect((await removeMember(owner, id, owner.id)).statusCode).toBe(204);
    const get = await app.inject({ url: `/api/v1/orgs/${id}`, headers: owner.headers });
    expect(get.statusCode).toBe(404);
  });

  it('lets a non-owner leave on their own', async () => {
    const owner = await harness.newUser();
    const viewer = await harness.newUser();
    const { id } = await createOrg(owner);
    await addMember(owner, id, viewer, 'VIEWER');
    expect((await removeMember(viewer, id, viewer.id)).statusCode).toBe(204);
  });

  it('forbids a VIEWER from removing another member', async () => {
    const owner = await harness.newUser();
    const viewer = await harness.newUser();
    const { id } = await createOrg(owner);
    await addMember(owner, id, viewer, 'VIEWER');
    expect((await removeMember(viewer, id, owner.id)).statusCode).toBe(403);
  });

  it('serializes concurrent demotions so exactly one owner remains', async () => {
    for (let i = 0; i < 5; i++) {
      const first = await harness.newUser();
      const second = await harness.newUser();
      const { id } = await createOrg(first);
      await addMember(first, id, second, 'OWNER');
      const results = await Promise.all([
        patchRole(first, id, first.id, 'VIEWER'),
        patchRole(second, id, second.id, 'VIEWER'),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const owners = await harness.sql`
        select 1 from memberships where org_id = ${id} and role = 'OWNER'`;
      expect(owners).toHaveLength(1);
    }
  });

  it('lets an organization delete cascade its memberships without tripping the trigger', async () => {
    const owner = await harness.newUser();
    const { id } = await createOrg(owner);
    await harness.sql`delete from organizations where id = ${id}`;
    const left = await harness.sql<
      { n: number }[]
    >`select 1 as n from memberships where org_id = ${id}`;
    expect(left).toHaveLength(0);
  });
});

describe('row level security', () => {
  it('shows an authenticated role only its own rows', async () => {
    const a = await harness.newUser();
    const b = await harness.newUser();
    const { id: orgA } = await createOrg(a);
    const { id: orgB } = await createOrg(b);
    const seen = await harness.sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${a.id}, true)`;
      return {
        orgs: await tx<{ id: string }[]>`select id from organizations`,
        memberships: await tx<{ org_id: string }[]>`select org_id from memberships`,
        profiles: await tx<{ id: string }[]>`select id from profiles`,
      };
    });
    const orgIds = seen.orgs.map((o) => o.id);
    expect(orgIds).toContain(orgA);
    expect(orgIds).not.toContain(orgB);
    expect(seen.memberships.map((m) => m.org_id)).not.toContain(orgB);
    expect(seen.profiles.map((p) => p.id)).toEqual([a.id]);
  });

  it('denies writes to the authenticated role', async () => {
    const a = await harness.newUser();
    const { id } = await createOrg(a);
    const attempt = harness.sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${a.id}, true)`;
      await tx`update organizations set name = 'x' where id = ${id}`;
    });
    await expect(attempt).rejects.toThrow(/permission denied/);
  });
});
