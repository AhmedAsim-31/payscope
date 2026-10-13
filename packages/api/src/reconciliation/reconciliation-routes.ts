import { and, eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import {
  findingDetailSchema,
  findingPageSchema,
  findingQuerySchema,
  runDetailSchema,
  runPageSchema,
  runQuerySchema,
  startRunBodySchema,
  updateFindingBodySchema,
} from '@payscope/shared/reconciliation-schemas';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { pgErrorCode } from '../db/pg-errors';
import { providerConnectionsTable } from '../db/schema/providers';
import { reconciliationRunsTable } from '../db/schema/reconciliation';
import { ApiHttpError } from '../http-error';
import { RUN_RECONCILIATION_JOB_KIND } from '../jobs/handlers/run-reconciliation';
import { enqueueJob } from '../jobs/job-queue';
import { currentOrg, currentUserId } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { resolveProviderTarget } from './provider-checks';
import {
  getFinding,
  getRun,
  listFindings,
  listRuns,
  toFindingDetail,
  toRunDetail,
  triageFinding,
} from './reconciliation-repo';

const orgParams = z.object({ orgId: z.uuid() });
const UNIQUE_VIOLATION = '23505';

type Options = { db: Db; adapters: AdapterRegistry; cipher: CredentialsCipher };

async function assertRunnable(
  { db, adapters, cipher }: Options,
  orgId: string,
  body: z.output<typeof startRunBodySchema>,
) {
  if (body.mode === 'provider' && !body.connectionId) {
    throw new ApiHttpError(400, 'CONNECTION_REQUIRED', 'Provider mode needs a connectionId');
  }
  if (!body.connectionId) return;
  const [connection] = await db
    .select({
      id: providerConnectionsTable.id,
      provider: providerConnectionsTable.provider,
      credentialsCiphertext: providerConnectionsTable.credentialsCiphertext,
    })
    .from(providerConnectionsTable)
    .where(
      and(
        eq(providerConnectionsTable.orgId, orgId),
        eq(providerConnectionsTable.id, body.connectionId),
      ),
    );
  if (!connection) throw new ApiHttpError(404, 'NOT_FOUND', 'Connection not found');
  if (body.mode === 'provider') {
    const resolved = resolveProviderTarget(connection, adapters, cipher);
    if (!resolved.ok) {
      throw new ApiHttpError(422, 'PROVIDER_MODE_UNAVAILABLE', resolved.reason);
    }
  }
}

export const reconciliationRoutes: FastifyPluginCallbackZod<Options> = (app, options, done) => {
  const { db } = options;
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  const base = '/api/v1/orgs/:orgId/reconciliation';
  const notFound = (what: string) => new ApiHttpError(404, 'NOT_FOUND', `${what} not found`);

  app.post(
    `${base}/runs`,
    {
      preHandler: requireOrg(db, 'reconciliation:run'),
      schema: {
        params: orgParams,
        body: startRunBodySchema,
        response: { 202: runDetailSchema },
      },
    },
    async (request, reply) => {
      const orgId = currentOrg(request).id;
      const { connectionId, mode } = request.body;
      await assertRunnable(options, orgId, request.body);
      try {
        const run = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(reconciliationRunsTable)
            .values({
              orgId,
              connectionId: connectionId ?? null,
              mode,
              scope: { connectionId: connectionId ?? null },
              triggeredBy: currentUserId(request),
            })
            .returning();
          if (!row) throw new Error('run insert returned no row');
          await enqueueJob(tx, {
            kind: RUN_RECONCILIATION_JOB_KIND,
            payload: { runId: row.id },
            orgId,
            idempotencyKey: `run:${row.id}`,
          });
          return row;
        });
        return reply.code(202).send(toRunDetail(run));
      } catch (err) {
        if (pgErrorCode(err) === UNIQUE_VIOLATION) {
          throw new ApiHttpError(409, 'RUN_IN_PROGRESS', 'A reconciliation run is already running');
        }
        throw err;
      }
    },
  );

  app.get(
    `${base}/runs`,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: { params: orgParams, querystring: runQuerySchema, response: { 200: runPageSchema } },
    },
    (request) => listRuns(db, currentOrg(request).id, request.query),
  );

  app.get(
    `${base}/runs/:runId`,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: {
        params: orgParams.extend({ runId: z.uuid() }),
        response: { 200: runDetailSchema },
      },
    },
    async (request) => {
      const run = await getRun(db, currentOrg(request).id, request.params.runId);
      if (!run) throw notFound('Run');
      return run;
    },
  );

  app.get(
    `${base}/findings`,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: {
        params: orgParams,
        querystring: findingQuerySchema,
        response: { 200: findingPageSchema },
      },
    },
    (request) => listFindings(db, currentOrg(request).id, request.query),
  );

  app.get(
    `${base}/findings/:findingId`,
    {
      preHandler: requireOrg(db, 'records:read'),
      schema: {
        params: orgParams.extend({ findingId: z.uuid() }),
        response: { 200: findingDetailSchema },
      },
    },
    async (request) => {
      const row = await getFinding(db, currentOrg(request).id, request.params.findingId);
      if (!row) throw notFound('Finding');
      return toFindingDetail(row);
    },
  );

  app.patch(
    `${base}/findings/:findingId`,
    {
      preHandler: requireOrg(db, 'findings:update'),
      schema: {
        params: orgParams.extend({ findingId: z.uuid() }),
        body: updateFindingBodySchema,
        response: { 200: findingDetailSchema },
      },
    },
    async (request) => {
      const orgId = currentOrg(request).id;
      const { findingId } = request.params;
      const updated = await triageFinding(
        db,
        orgId,
        findingId,
        request.body.status,
        request.body.note,
      );
      if (updated) return toFindingDetail(updated);
      if (!(await getFinding(db, orgId, findingId))) throw notFound('Finding');
      throw new ApiHttpError(409, 'FINDING_CLOSED', 'Finding is already resolved or dismissed');
    },
  );

  done();
};
