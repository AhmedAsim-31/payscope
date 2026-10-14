import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { findingQuerySchema } from '@payscope/shared/reconciliation-schemas';
import { paymentQuerySchema } from '@payscope/shared/records-schemas';
import type { Db } from '../db/client';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { listFindings } from '../reconciliation/reconciliation-repo';
import { listPayments } from '../records/payments-repo';
import { toCsv } from './csv';

export const EXPORT_MAX_ROWS = 5000;

const orgParams = z.object({ orgId: z.uuid() });
const paymentExportQuerySchema = paymentQuerySchema.omit({ cursor: true, limit: true });
const findingExportQuerySchema = findingQuerySchema.omit({ cursor: true, limit: true });
const exportPage = { limit: EXPORT_MAX_ROWS, cursor: undefined };

const PAYMENT_HEADER = [
  'id',
  'provider',
  'connection_id',
  'provider_payment_id',
  'status',
  'amount_minor',
  'amount_refunded_minor',
  'currency',
  'customer_id',
  'customer_email',
  'provider_created_at',
  'created_at',
];

const FINDING_HEADER = [
  'id',
  'type',
  'severity',
  'status',
  'subject_type',
  'subject_id',
  'recommended_action',
  'first_seen_run_id',
  'last_seen_run_id',
  'created_at',
  'updated_at',
];

function sendCsv(reply: FastifyReply, name: string, csv: string, truncated: boolean) {
  const day = new Date().toISOString().slice(0, 10);
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}-${day}.csv"`)
    .header('cache-control', 'no-store')
    .header('x-export-truncated', String(truncated))
    .send(csv);
}

type Options = { db: Db };

export const exportRoutes: FastifyPluginCallbackZod<Options> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());
  const preHandler = [requireOrg(db, 'records:export'), app.rateLimitFor('search')];
  const base = '/api/v1/orgs/:orgId';

  app.get(
    `${base}/payments/export`,
    { preHandler, schema: { params: orgParams, querystring: paymentExportQuerySchema } },
    async (request, reply) => {
      const page = await listPayments(db, currentOrg(request).id, {
        ...request.query,
        ...exportPage,
      });
      const rows = page.items.map((p) => [
        p.id,
        p.provider,
        p.connectionId,
        p.providerPaymentId,
        p.status,
        p.amount.amountMinor,
        p.amountRefunded.amountMinor,
        p.amount.currency,
        p.customer?.id ?? null,
        p.customer?.email ?? null,
        p.providerCreatedAt,
        p.createdAt,
      ]);
      return sendCsv(reply, 'payments', toCsv(PAYMENT_HEADER, rows), page.nextCursor !== null);
    },
  );

  app.get(
    `${base}/reconciliation/findings/export`,
    { preHandler, schema: { params: orgParams, querystring: findingExportQuerySchema } },
    async (request, reply) => {
      const page = await listFindings(db, currentOrg(request).id, {
        ...request.query,
        ...exportPage,
      });
      const rows = page.items.map((f) => [
        f.id,
        f.type,
        f.severity,
        f.status,
        f.subjectType,
        f.subjectId,
        f.recommendedAction,
        f.firstSeenRunId,
        f.lastSeenRunId,
        f.createdAt,
        f.updatedAt,
      ]);
      return sendCsv(reply, 'findings', toCsv(FINDING_HEADER, rows), page.nextCursor !== null);
    },
  );

  done();
};
