import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditPageSchema, auditQuerySchema } from '@payscope/shared/audit-schemas';
import type { Db } from '../db/client';
import { auditLogsTable as t } from '../db/schema/operations';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { cursorTsColumn, iso, keysetAfter, toPage } from '../records/keyset';

function asState(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

export const auditRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());

  app.get(
    '/api/v1/orgs/:orgId/audit',
    {
      preHandler: requireOrg(db, 'audit:read'),
      schema: {
        params: z.object({ orgId: z.uuid() }),
        querystring: auditQuerySchema,
        response: { 200: auditPageSchema },
      },
    },
    async (request) => {
      const q = request.query;
      const rows = await db
        .select({ entry: t, cursorTs: cursorTsColumn(t.createdAt) })
        .from(t)
        .where(
          and(
            eq(t.orgId, currentOrg(request).id),
            q.action === undefined ? undefined : eq(t.action, q.action),
            q.actor === undefined ? undefined : eq(t.actorId, q.actor),
            q.targetType === undefined ? undefined : eq(t.targetType, q.targetType),
            q.targetId === undefined ? undefined : eq(t.targetId, q.targetId),
            keysetAfter(t.createdAt, t.id, q.cursor),
          ),
        )
        .orderBy(desc(t.createdAt), desc(t.id))
        .limit(q.limit + 1);
      return toPage(
        rows.map((x) => ({ ...x, id: x.entry.id })),
        q.limit,
        ({ entry: e }) => ({
          id: e.id,
          actorId: e.actorId,
          actorType: e.actorType,
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          reason: e.reason,
          previousState: asState(e.previousState),
          resultingState: asState(e.resultingState),
          outcome: e.outcome,
          requestId: e.requestId,
          createdAt: iso(e.createdAt),
        }),
      );
    },
  );

  done();
};
