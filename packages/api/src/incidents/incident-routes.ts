import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  incidentActionBodySchema,
  incidentDetailSchema,
  incidentPageSchema,
  incidentQuerySchema,
} from '@payscope/shared/incident-schemas';
import { audited, auditContext } from '../audit/audit-log';
import type { Db } from '../db/client';
import { ApiHttpError } from '../http-error';
import { currentOrg, currentUserId } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import {
  getIncident,
  getIncidentDetail,
  listIncidents,
  recordIncidentAction,
  transitionIncident,
} from './incident-repo';

const orgParams = z.object({ orgId: z.uuid() });
const incidentParams = orgParams.extend({ incidentId: z.uuid() });
const notFound = () => new ApiHttpError(404, 'NOT_FOUND', 'Incident not found');

export const incidentRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  const base = '/api/v1/orgs/:orgId/incidents';

  app.get(
    base,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: {
        params: orgParams,
        querystring: incidentQuerySchema,
        response: { 200: incidentPageSchema },
      },
    },
    (request) => listIncidents(db, currentOrg(request).id, request.query),
  );

  app.get(
    `${base}/:incidentId`,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: { params: incidentParams, response: { 200: incidentDetailSchema } },
    },
    async (request) => {
      const detail = await getIncidentDetail(db, currentOrg(request).id, request.params.incidentId);
      if (!detail) throw notFound();
      return detail;
    },
  );

  app.post(
    `${base}/:incidentId/actions`,
    {
      preHandler: requireOrg(db, 'findings:update'),
      schema: {
        params: incidentParams,
        body: incidentActionBodySchema,
        response: { 200: incidentDetailSchema },
      },
    },
    async (request) => {
      const orgId = currentOrg(request).id;
      const { incidentId } = request.params;
      const { action, note } = request.body;
      await audited(
        db,
        {
          ...auditContext(request),
          action: `incident.${action}`,
          targetType: 'incident',
          targetId: incidentId,
          reason: note,
        },
        async (tx) => {
          const current = await getIncident(tx, orgId, incidentId);
          if (!current) throw notFound();
          let status = current.status;
          if (action !== 'note') {
            const moved = await transitionIncident(tx, orgId, incidentId, action, note);
            if (!moved) {
              throw new ApiHttpError(409, 'INVALID_TRANSITION', `Incident cannot be ${action}d`);
            }
            status = moved.status;
          }
          await recordIncidentAction(tx, {
            orgId,
            incidentId,
            actorId: currentUserId(request),
            action,
            note,
          });
          return {
            value: undefined,
            previousState: { status: current.status },
            resultingState: { status },
          };
        },
      );
      const detail = await getIncidentDetail(db, orgId, incidentId);
      if (!detail) throw notFound();
      return detail;
    },
  );

  done();
};
