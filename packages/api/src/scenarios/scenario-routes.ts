import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  SCENARIO_IDS,
  resetResultSchema,
  scenarioCatalogSchema,
  scenarioRunSchema,
} from '@payscope/shared/scenario-schemas';
import { audited, auditContext } from '../audit/audit-log';
import type { Db } from '../db/client';
import { demoScenarioRunsTable } from '../db/schema/scenarios';
import { ApiHttpError } from '../http-error';
import { enqueueJob } from '../jobs/job-queue';
import { currentOrg, currentUserId } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { RUN_SCENARIO_JOB_KIND } from './scenario-job';
import { resetScenarioLab } from './scenario-reset';
import {
  getScenarioRun,
  hasRunningScenario,
  listCatalog,
  toScenarioRun,
} from './scenario-run-repo';

const orgParams = z.object({ orgId: z.uuid() });
const busy = () => new ApiHttpError(409, 'SCENARIO_RUNNING', 'A scenario is already running');

export const scenarioRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());
  const base = '/api/v1/orgs/:orgId';
  const runGuards = () => [requireOrg(db, 'scenarios:run'), app.rateLimitFor('scenarioRun')];

  app.get(
    `${base}/scenarios`,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: { params: orgParams, response: { 200: scenarioCatalogSchema } },
    },
    async (request) => ({ data: await listCatalog(db, currentOrg(request).id) }),
  );

  app.post(
    `${base}/scenarios/reset`,
    {
      preHandler: runGuards(),
      schema: { params: orgParams, response: { 200: resetResultSchema } },
    },
    (request) => {
      const orgId = currentOrg(request).id;
      return audited(
        db,
        { ...auditContext(request), action: 'scenario.reset', targetType: 'scenario_lab' },
        async () => {
          if (await hasRunningScenario(db, orgId)) throw busy();
          const value = await resetScenarioLab(db, orgId);
          return { value, resultingState: value };
        },
      );
    },
  );

  app.post(
    `${base}/scenarios/:scenarioId/run`,
    {
      preHandler: runGuards(),
      schema: {
        params: orgParams.extend({ scenarioId: z.enum(SCENARIO_IDS) }),
        response: { 202: scenarioRunSchema },
      },
    },
    async (request, reply) => {
      const orgId = currentOrg(request).id;
      const { scenarioId } = request.params;
      const run = await audited(
        db,
        {
          ...auditContext(request),
          action: 'scenario.run',
          targetType: 'scenario_run',
        },
        async (tx) => {
          if (await hasRunningScenario(tx, orgId)) throw busy();
          const [row] = await tx
            .insert(demoScenarioRunsTable)
            .values({ orgId, scenarioId, startedBy: currentUserId(request) })
            .returning();
          if (!row) throw new Error('scenario run insert returned no row');
          await enqueueJob(tx, {
            kind: RUN_SCENARIO_JOB_KIND,
            payload: { runId: row.id },
            orgId,
            idempotencyKey: `scenario-run:${row.id}`,
          });
          return { value: row, targetId: row.id, resultingState: { scenarioId } };
        },
      );
      return reply.code(202).send(toScenarioRun(run));
    },
  );

  app.get(
    `${base}/scenario-runs/:runId`,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: {
        params: orgParams.extend({ runId: z.uuid() }),
        response: { 200: scenarioRunSchema },
      },
    },
    async (request) => {
      const run = await getScenarioRun(db, currentOrg(request).id, request.params.runId);
      if (!run) throw new ApiHttpError(404, 'NOT_FOUND', 'Scenario run not found');
      return toScenarioRun(run);
    },
  );

  done();
};
