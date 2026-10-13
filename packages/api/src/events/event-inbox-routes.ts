import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  eventDetailSchema,
  eventPageSchema,
  eventQuerySchema,
  jobSummarySchema,
  retryResultSchema,
} from '@payscope/shared/events-schemas';
import { audited, auditContext } from '../audit/audit-log';
import type { Db } from '../db/client';
import { ApiHttpError } from '../http-error';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { getEvent, listEvents, summarizeJobs } from './event-inbox-repo';
import { retryEvent } from './event-retry';

const orgParams = z.object({ orgId: z.uuid() });
const eventParams = orgParams.extend({ eventId: z.uuid() });

type Options = { db: Db };

export const eventInboxRoutes: FastifyPluginCallbackZod<Options> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  const base = '/api/v1/orgs/:orgId';
  const canRead = requireOrg(db, 'events:read');

  app.get(
    `${base}/events`,
    {
      preHandler: canRead,
      schema: {
        params: orgParams,
        querystring: eventQuerySchema,
        response: { 200: eventPageSchema },
      },
    },
    (request) => listEvents(db, currentOrg(request).id, request.query),
  );

  app.get(
    `${base}/events/:eventId`,
    { preHandler: canRead, schema: { params: eventParams, response: { 200: eventDetailSchema } } },
    async (request) => {
      const row = await getEvent(db, currentOrg(request).id, request.params.eventId);
      if (!row) throw new ApiHttpError(404, 'NOT_FOUND', 'Event not found');
      return row;
    },
  );

  app.get(
    `${base}/jobs/summary`,
    { preHandler: canRead, schema: { params: orgParams, response: { 200: jobSummarySchema } } },
    (request) => summarizeJobs(db, currentOrg(request).id),
  );

  app.post(
    `${base}/events/:eventId/retry`,
    {
      preHandler: requireOrg(db, 'jobs:retry'),
      schema: { params: eventParams, response: { 202: retryResultSchema } },
    },
    async (request, reply) => {
      const { eventId } = request.params;
      await audited(
        db,
        { ...auditContext(request), action: 'event.retry', targetType: 'event', targetId: eventId },
        async (tx) => {
          await retryEvent(tx, currentOrg(request).id, eventId);
          return { value: undefined, resultingState: { status: 'pending' } };
        },
      );
      return reply.code(202).send({ eventId: request.params.eventId, status: 'pending' as const });
    },
  );

  done();
};
