import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  correctEntitlementBodySchema,
  reprocessEventBodySchema,
  repairHeadersSchema,
  repairResultSchema,
  resolveFindingBodySchema,
} from '@payscope/shared/repair-schemas';
import type { Db } from '../db/client';
import { currentOrg, currentUserId } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { runRepair } from './idempotent-repair';
import { correctEntitlement, reprocessEvent, resolveFinding } from './repair-actions';

const orgParams = z.object({ orgId: z.uuid() });

export const repairRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());
  const base = '/api/v1/orgs/:orgId/repairs';
  const route = {
    preHandler: [requireOrg(db, 'repairs:execute'), app.rateLimitFor('repairAction')],
    response: { 200: repairResultSchema },
  };

  app.post(
    `${base}/reprocess-event`,
    {
      preHandler: route.preHandler,
      schema: {
        params: orgParams,
        headers: repairHeadersSchema,
        body: reprocessEventBodySchema,
        response: route.response,
      },
    },
    (request) => {
      const { eventId, reason } = request.body;
      return runRepair(
        db,
        {
          ...context(request),
          action: 'reprocess_event',
          targetType: 'event',
          targetId: eventId,
          reason,
          body: request.body,
        },
        async (tx) => {
          const done = await reprocessEvent(tx, currentOrg(request).id, eventId);
          return { ...done, targetId: eventId };
        },
      );
    },
  );

  app.post(
    `${base}/correct-entitlement`,
    {
      preHandler: route.preHandler,
      schema: {
        params: orgParams,
        headers: repairHeadersSchema,
        body: correctEntitlementBodySchema,
        response: route.response,
      },
    },
    (request) => {
      const { findingId, reason } = request.body;
      return runRepair(
        db,
        {
          ...context(request),
          action: 'correct_entitlement',
          targetType: 'finding',
          targetId: findingId,
          reason,
          body: request.body,
        },
        async (tx) => ({
          ...(await correctEntitlement(tx, currentOrg(request).id, findingId, reason)),
          targetId: findingId,
        }),
      );
    },
  );

  app.post(
    `${base}/resolve-finding`,
    {
      preHandler: route.preHandler,
      schema: {
        params: orgParams,
        headers: repairHeadersSchema,
        body: resolveFindingBodySchema,
        response: route.response,
      },
    },
    (request) => {
      const { findingId, reason } = request.body;
      return runRepair(
        db,
        {
          ...context(request),
          action: 'resolve_finding',
          targetType: 'finding',
          targetId: findingId,
          reason,
          body: request.body,
        },
        async (tx) => ({
          ...(await resolveFinding(tx, currentOrg(request).id, findingId, reason)),
          targetId: findingId,
        }),
      );
    },
  );

  done();

  function context(request: Parameters<typeof currentUserId>[0]) {
    return {
      orgId: currentOrg(request).id,
      actorId: currentUserId(request),
      requestId: request.id,
      idempotencyKey: String(request.headers['idempotency-key']),
    };
  }
};
