import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ROLES, can, type Role } from '@payscope/shared/permissions';
import { audited, auditContext } from '../audit/audit-log';
import type { Db } from '../db/client';
import { rethrowPgError } from '../db/pg-errors';
import { membershipsTable, profilesTable } from '../db/schema/identity';
import { ApiHttpError } from '../http-error';
import { currentOrg, currentUserId } from './request-context';
import { requireOrg } from './require-org';

const MAX_LISTED_MEMBERS = 500;

const memberSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(ROLES),
});

const orgParams = z.object({ orgId: z.uuid() });
const memberParams = z.object({ orgId: z.uuid(), userId: z.uuid() });
const addMemberBody = z.object({ email: z.email(), role: z.enum(ROLES) });
const changeRoleBody = z.object({ role: z.enum(ROLES) });

const memberColumns = {
  userId: membershipsTable.userId,
  email: profilesTable.email,
  displayName: profilesTable.displayName,
  role: membershipsTable.role,
};

const forbidden = (message: string) => new ApiHttpError(403, 'FORBIDDEN', message);
const memberNotFound = () => new ApiHttpError(404, 'NOT_FOUND', 'Member not found');

export const memberRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  const findMember = async (orgId: string, userId: string) => {
    const [member] = await db
      .select(memberColumns)
      .from(membershipsTable)
      .innerJoin(profilesTable, eq(profilesTable.id, membershipsTable.userId))
      .where(and(eq(membershipsTable.orgId, orgId), eq(membershipsTable.userId, userId)))
      .limit(1);
    return member;
  };

  const roleOf = async (tx: Pick<Db, 'select'>, orgId: string, userId: string) => {
    const [row] = await tx
      .select({ role: membershipsTable.role })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.orgId, orgId), eq(membershipsTable.userId, userId)));
    return row?.role ?? null;
  };

  const ownerGuard = (callerRole: Role) =>
    callerRole === 'OWNER' ? sql`true` : ne(membershipsTable.role, 'OWNER');

  /** Called after a guarded write matched nothing: tells a missing member from an owner-only target. */
  const missOrForbidden = async (orgId: string, userId: string) => {
    if (await findMember(orgId, userId)) {
      throw forbidden('Only an owner can change or remove an owner');
    }
    throw memberNotFound();
  };

  app.get(
    '/api/v1/orgs/:orgId/members',
    {
      preHandler: requireOrg(db, 'members:read'),
      schema: {
        params: orgParams,
        response: { 200: z.object({ members: z.array(memberSchema) }) },
      },
    },
    async (request) => {
      const members = await db
        .select(memberColumns)
        .from(membershipsTable)
        .innerJoin(profilesTable, eq(profilesTable.id, membershipsTable.userId))
        .where(eq(membershipsTable.orgId, currentOrg(request).id))
        .orderBy(asc(profilesTable.email))
        .limit(MAX_LISTED_MEMBERS);
      return { members };
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/members',
    {
      preHandler: requireOrg(db, 'members:manage'),
      schema: { params: orgParams, body: addMemberBody, response: { 201: memberSchema } },
    },
    async (request, reply) => {
      const org = currentOrg(request);
      const { email, role } = request.body;
      if (role === 'OWNER' && org.role !== 'OWNER') {
        throw forbidden('Only an owner can grant the owner role');
      }
      const [profile] = await db
        .select({ id: profilesTable.id })
        .from(profilesTable)
        .where(sql`lower(${profilesTable.email}) = lower(${email})`)
        .orderBy(asc(profilesTable.createdAt))
        .limit(1);
      if (!profile) throw new ApiHttpError(404, 'NOT_FOUND', 'No user with that email');
      await audited(
        db,
        {
          ...auditContext(request),
          action: 'member.add',
          targetType: 'member',
          targetId: profile.id,
        },
        async (tx) => {
          try {
            await tx.insert(membershipsTable).values({ orgId: org.id, userId: profile.id, role });
          } catch (err) {
            rethrowPgError(err);
          }
          return { value: undefined, resultingState: { role } };
        },
      );
      const member = await findMember(org.id, profile.id);
      if (!member) throw memberNotFound();
      return reply.code(201).send(member);
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/members/:userId',
    {
      preHandler: requireOrg(db, 'members:manage'),
      schema: { params: memberParams, body: changeRoleBody, response: { 200: memberSchema } },
    },
    async (request) => {
      const org = currentOrg(request);
      const { userId } = request.params;
      const { role } = request.body;
      if (role === 'OWNER' && org.role !== 'OWNER') {
        throw forbidden('Only an owner can grant the owner role');
      }
      await audited(
        db,
        {
          ...auditContext(request),
          action: 'member.role_change',
          targetType: 'member',
          targetId: userId,
        },
        async (tx) => {
          const previousRole = await roleOf(tx, org.id, userId);
          let updated: { userId: string }[] = [];
          try {
            updated = await tx
              .update(membershipsTable)
              .set({ role, updatedAt: new Date() })
              .where(
                and(
                  eq(membershipsTable.orgId, org.id),
                  eq(membershipsTable.userId, userId),
                  ownerGuard(org.role),
                ),
              )
              .returning({ userId: membershipsTable.userId });
          } catch (err) {
            rethrowPgError(err);
          }
          if (updated.length === 0) return missOrForbidden(org.id, userId);
          return {
            value: undefined,
            previousState: { role: previousRole },
            resultingState: { role },
          };
        },
      );
      const member = await findMember(org.id, userId);
      if (!member) throw memberNotFound();
      return member;
    },
  );

  app.delete(
    '/api/v1/orgs/:orgId/members/:userId',
    {
      preHandler: requireOrg(db, 'org:read'),
      schema: { params: memberParams },
    },
    async (request, reply) => {
      const org = currentOrg(request);
      const { userId } = request.params;
      if (userId !== currentUserId(request) && !can(org.role, 'members:manage')) {
        throw forbidden('Insufficient permissions');
      }
      await audited(
        db,
        {
          ...auditContext(request),
          action: 'member.remove',
          targetType: 'member',
          targetId: userId,
        },
        async (tx) => {
          const previousRole = await roleOf(tx, org.id, userId);
          let removed: { userId: string }[] = [];
          try {
            removed = await tx
              .delete(membershipsTable)
              .where(
                and(
                  eq(membershipsTable.orgId, org.id),
                  eq(membershipsTable.userId, userId),
                  ownerGuard(org.role),
                ),
              )
              .returning({ userId: membershipsTable.userId });
          } catch (err) {
            rethrowPgError(err);
          }
          if (removed.length === 0) return missOrForbidden(org.id, userId);
          return { value: undefined, previousState: { role: previousRole }, resultingState: null };
        },
      );
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/members/:userId/transfer-ownership',
    {
      preHandler: requireOrg(db, 'ownership:transfer'),
      schema: { params: memberParams, response: { 200: memberSchema } },
    },
    async (request) => {
      const org = currentOrg(request);
      const ownerId = currentUserId(request);
      const { userId } = request.params;
      if (userId === ownerId) {
        throw new ApiHttpError(422, 'SELF_TRANSFER', 'Choose another member to receive ownership');
      }
      await audited(
        db,
        {
          ...auditContext(request),
          action: 'ownership.transfer',
          targetType: 'member',
          targetId: userId,
        },
        async (tx) => {
          const targetRole = await roleOf(tx, org.id, userId);
          const now = new Date();
          const promoted = await tx
            .update(membershipsTable)
            .set({ role: 'OWNER', updatedAt: now })
            .where(
              and(
                eq(membershipsTable.orgId, org.id),
                eq(membershipsTable.userId, userId),
                ne(membershipsTable.role, 'OWNER'),
              ),
            )
            .returning({ userId: membershipsTable.userId });
          if (promoted.length === 0) {
            if ((await roleOf(tx, org.id, userId)) === 'OWNER') {
              throw new ApiHttpError(409, 'ALREADY_OWNER', 'That member is already an owner');
            }
            throw memberNotFound();
          }
          const demoted = await tx
            .update(membershipsTable)
            .set({ role: 'ADMIN', updatedAt: now })
            .where(
              and(
                eq(membershipsTable.orgId, org.id),
                eq(membershipsTable.userId, ownerId),
                eq(membershipsTable.role, 'OWNER'),
              ),
            )
            .returning({ userId: membershipsTable.userId });
          if (demoted.length === 0) {
            throw new ApiHttpError(409, 'OWNERSHIP_CHANGED', 'You are no longer an owner');
          }
          return {
            value: undefined,
            previousState: { ownerId, targetRole },
            resultingState: { ownerId: userId, previousOwnerRole: 'ADMIN' },
          };
        },
      );
      const member = await findMember(org.id, userId);
      if (!member) throw memberNotFound();
      return member;
    },
  );

  done();
};
