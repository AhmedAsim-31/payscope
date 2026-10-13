import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  overviewQuerySchema,
  overviewSchema,
  type Overview,
} from '@payscope/shared/overview-schemas';
import type { Db } from '../db/client';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { createOverviewCache } from './overview-cache';
import { loadOverview } from './overview-repo';

const CACHE_TTL_MS = 15_000;

type Options = { db: Db };

export const overviewRoutes: FastifyPluginCallbackZod<Options> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  const cached = createOverviewCache<Overview>(CACHE_TTL_MS);

  app.get(
    '/api/v1/orgs/:orgId/overview',
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: {
        params: z.object({ orgId: z.uuid() }),
        querystring: overviewQuerySchema,
        response: { 200: overviewSchema },
      },
    },
    (request, reply) => {
      const orgId = currentOrg(request).id;
      const { range } = request.query;
      reply.header('cache-control', 'private, no-store');
      return cached(`${orgId}:${range}`, () => loadOverview(db, orgId, range));
    },
  );

  done();
};
