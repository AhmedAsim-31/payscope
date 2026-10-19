import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ROLES } from '@payscope/shared/permissions';
import { writeAudit } from '../audit/audit-log';
import type { Db } from '../db/client';
import { rethrowPgError } from '../db/pg-errors';
import { membershipsTable, organizationsTable } from '../db/schema/identity';
import { ApiHttpError } from '../http-error';
import { currentOrg, currentUserId } from './request-context';
import { requireOrg } from './require-org';

const MAX_LISTED_ORGS = 100;
export const MAX_OWNED_ORGS = 5;

const orgSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(ROLES),
});

const createOrgBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]{3,48}$/),
});

const orgParams = z.object({ orgId: z.uuid() });

export const orgRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.get(
    '/api/v1/orgs',
    { schema: { response: { 200: z.object({ orgs: z.array(orgSchema) }) } } },
    async (request) => {
      const orgs = await db
        .select({
          id: organizationsTable.id,
          name: organizationsTable.name,
          slug: organizationsTable.slug,
          role: membershipsTable.role,
        })
        .from(membershipsTable)
        .innerJoin(organizationsTable, eq(organizationsTable.id, membershipsTable.orgId))
        .where(eq(membershipsTable.userId, currentUserId(request)))
        .orderBy(asc(organizationsTable.name))
        .limit(MAX_LISTED_ORGS);
      return { orgs };
    },
  );

  app.post(
    '/api/v1/orgs',
    { schema: { body: createOrgBody, response: { 201: orgSchema } } },
    async (request, reply) => {
      const userId = currentUserId(request);
      try {
        const created = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`org-create:${userId}`}))`);
          const [owned] = await tx
            .select({ n: count() })
            .from(membershipsTable)
            .where(and(eq(membershipsTable.userId, userId), eq(membershipsTable.role, 'OWNER')));
          if ((owned?.n ?? 0) >= MAX_OWNED_ORGS) {
            throw new ApiHttpError(
              409,
              'ORG_LIMIT_REACHED',
              `You can own at most ${MAX_OWNED_ORGS} organizations`,
            );
          }
          const [org] = await tx
            .insert(organizationsTable)
            .values({ name: request.body.name, slug: request.body.slug })
            .returning({
              id: organizationsTable.id,
              name: organizationsTable.name,
              slug: organizationsTable.slug,
            });
          if (!org) throw new Error('organization insert returned no row');
          await tx.insert(membershipsTable).values({ orgId: org.id, userId, role: 'OWNER' });
          await writeAudit(tx, {
            orgId: org.id,
            actorId: userId,
            action: 'org.create',
            targetType: 'organization',
            targetId: org.id,
            resultingState: { name: org.name, slug: org.slug },
            requestId: request.id,
          });
          return { ...org, role: 'OWNER' as const };
        });
        return reply.code(201).send(created);
      } catch (err) {
        return rethrowPgError(err);
      }
    },
  );

  app.get(
    '/api/v1/orgs/:orgId',
    {
      preHandler: requireOrg(db, 'org:read'),
      schema: { params: orgParams, response: { 200: orgSchema } },
    },
    async (request) => {
      const { id, role } = currentOrg(request);
      const [org] = await db
        .select({
          id: organizationsTable.id,
          name: organizationsTable.name,
          slug: organizationsTable.slug,
        })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, id))
        .limit(1);
      if (!org) throw new ApiHttpError(404, 'NOT_FOUND', 'Organization not found');
      return { ...org, role };
    },
  );

  done();
};
