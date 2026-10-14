import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditPageSchema, auditQuerySchema } from '@payscope/shared/audit-schemas';
import type { Db } from '../db/client';
import { membershipsTable, profilesTable } from '../db/schema/identity';
import { auditLogsTable as t } from '../db/schema/operations';
import {
  entitlementRecordsTable,
  paymentRecordsTable,
  subscriptionRecordsTable,
} from '../db/schema/records';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { escapeLike } from '../records/escape-like';
import { cursorTsColumn, iso, keysetAfter, toPage } from '../records/keyset';

function matchesText(text: string) {
  const pattern = `%${escapeLike(text)}%`;
  return or(
    ilike(t.action, pattern),
    ilike(t.targetType, pattern),
    ilike(t.targetId, pattern),
    ilike(sql`${t.actorId}::text`, pattern),
    ilike(sql`${t.actorType}::text`, pattern),
    ilike(t.reason, pattern),
  );
}

function touchesCustomer(db: Db, orgId: string, customerId: string) {
  const owned = (
    targetType: string,
    table:
      typeof paymentRecordsTable | typeof subscriptionRecordsTable | typeof entitlementRecordsTable,
  ) =>
    and(
      eq(t.targetType, targetType),
      inArray(
        t.targetId,
        db
          .select({ id: sql<string>`${table.id}::text` })
          .from(table)
          .where(and(eq(table.orgId, orgId), eq(table.customerId, customerId))),
      ),
    );
  return or(
    and(eq(t.targetType, 'customer'), eq(t.targetId, customerId)),
    owned('payment', paymentRecordsTable),
    owned('subscription', subscriptionRecordsTable),
    owned('entitlement', entitlementRecordsTable),
  );
}

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
      preHandler: [requireOrg(db, 'audit:read'), app.rateLimitFor('search')],
      schema: {
        params: z.object({ orgId: z.uuid() }),
        querystring: auditQuerySchema,
        response: { 200: auditPageSchema },
      },
    },
    async (request) => {
      const q = request.query;
      const orgId = currentOrg(request).id;
      const rows = await db
        .select({
          entry: t,
          actorEmail: profilesTable.email,
          cursorTs: cursorTsColumn(t.createdAt),
        })
        .from(t)
        // Only a current member of this org resolves to an email; other orgs' users stay null.
        .leftJoin(
          membershipsTable,
          and(eq(membershipsTable.orgId, t.orgId), eq(membershipsTable.userId, t.actorId)),
        )
        .leftJoin(profilesTable, eq(profilesTable.id, membershipsTable.userId))
        .where(
          and(
            eq(t.orgId, orgId),
            q.action === undefined ? undefined : eq(t.action, q.action),
            q.actor === undefined ? undefined : eq(t.actorId, q.actor),
            q.targetType === undefined ? undefined : eq(t.targetType, q.targetType),
            q.targetId === undefined ? undefined : eq(t.targetId, q.targetId),
            q.customerId === undefined ? undefined : touchesCustomer(db, orgId, q.customerId),
            q.from === undefined ? undefined : gte(t.createdAt, new Date(q.from)),
            q.to === undefined ? undefined : lt(t.createdAt, new Date(q.to)),
            q.q === undefined ? undefined : matchesText(q.q),
            keysetAfter(t.createdAt, t.id, q.cursor),
          ),
        )
        .orderBy(desc(t.createdAt), desc(t.id))
        .limit(q.limit + 1);
      return toPage(
        rows.map((x) => ({ ...x, id: x.entry.id })),
        q.limit,
        ({ entry: e, actorEmail }) => ({
          id: e.id,
          actorId: e.actorId,
          actorEmail,
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
