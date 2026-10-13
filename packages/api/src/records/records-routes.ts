import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  customerDetailSchema,
  customerPageSchema,
  customerQuerySchema,
  entitlementDetailSchema,
  entitlementPageSchema,
  entitlementQuerySchema,
  paymentDetailSchema,
  paymentPageSchema,
  paymentQuerySchema,
  subscriptionDetailSchema,
  subscriptionPageSchema,
  subscriptionQuerySchema,
} from '@payscope/shared/records-schemas';
import {
  ingestEntitlementBodySchema,
  ingestEntitlementResultSchema,
} from '@payscope/shared/entitlement-ingest-schemas';
import { repairHeadersSchema } from '@payscope/shared/repair-schemas';
import { auditContext } from '../audit/audit-log';
import { idempotentAudited } from '../audit/idempotent-audited';
import type { Db } from '../db/client';
import { ApiHttpError } from '../http-error';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { getCustomer, listCustomers } from './customers-repo';
import { assertNotFuture, ingestEntitlement } from './entitlement-ingest';
import { getEntitlement, listEntitlements } from './entitlements-repo';
import { getPayment, listPayments } from './payments-repo';
import { getSubscription, listSubscriptions } from './subscriptions-repo';

const orgParams = z.object({ orgId: z.uuid() });

const notFound = (what: string) => new ApiHttpError(404, 'NOT_FOUND', `${what} not found`);

type Options = { db: Db };

export const recordsRoutes: FastifyPluginCallbackZod<Options> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());
  const preHandler = requireOrg(db, 'records:read');
  const listPreHandler = [preHandler, app.rateLimitFor('search')];
  const base = '/api/v1/orgs/:orgId';

  app.get(
    `${base}/payments`,
    {
      preHandler: listPreHandler,
      schema: {
        params: orgParams,
        querystring: paymentQuerySchema,
        response: { 200: paymentPageSchema },
      },
    },
    (request) => listPayments(db, currentOrg(request).id, request.query),
  );

  app.get(
    `${base}/payments/:paymentId`,
    {
      preHandler,
      schema: {
        params: orgParams.extend({ paymentId: z.uuid() }),
        response: { 200: paymentDetailSchema },
      },
    },
    async (request) => {
      const row = await getPayment(db, currentOrg(request).id, request.params.paymentId);
      if (!row) throw notFound('Payment');
      return row;
    },
  );

  app.get(
    `${base}/subscriptions`,
    {
      preHandler: listPreHandler,
      schema: {
        params: orgParams,
        querystring: subscriptionQuerySchema,
        response: { 200: subscriptionPageSchema },
      },
    },
    (request) => listSubscriptions(db, currentOrg(request).id, request.query),
  );

  app.get(
    `${base}/subscriptions/:subscriptionId`,
    {
      preHandler,
      schema: {
        params: orgParams.extend({ subscriptionId: z.uuid() }),
        response: { 200: subscriptionDetailSchema },
      },
    },
    async (request) => {
      const row = await getSubscription(db, currentOrg(request).id, request.params.subscriptionId);
      if (!row) throw notFound('Subscription');
      return row;
    },
  );

  app.get(
    `${base}/customers`,
    {
      preHandler: listPreHandler,
      schema: {
        params: orgParams,
        querystring: customerQuerySchema,
        response: { 200: customerPageSchema },
      },
    },
    (request) => listCustomers(db, currentOrg(request).id, request.query),
  );

  app.get(
    `${base}/customers/:customerId`,
    {
      preHandler,
      schema: {
        params: orgParams.extend({ customerId: z.uuid() }),
        response: { 200: customerDetailSchema },
      },
    },
    async (request) => {
      const row = await getCustomer(db, currentOrg(request).id, request.params.customerId);
      if (!row) throw notFound('Customer');
      return row;
    },
  );

  app.get(
    `${base}/entitlements`,
    {
      preHandler: listPreHandler,
      schema: {
        params: orgParams,
        querystring: entitlementQuerySchema,
        response: { 200: entitlementPageSchema },
      },
    },
    (request) => listEntitlements(db, currentOrg(request).id, request.query),
  );

  app.post(
    `${base}/entitlements`,
    {
      preHandler: requireOrg(db, 'entitlements:ingest'),
      schema: {
        params: orgParams,
        headers: repairHeadersSchema,
        body: ingestEntitlementBodySchema,
        response: { 200: ingestEntitlementResultSchema },
      },
    },
    (request) => {
      assertNotFuture(request.body.observedAt);
      const orgId = currentOrg(request).id;
      return idempotentAudited(
        db,
        {
          audit: {
            ...auditContext(request),
            action: 'entitlement.ingest',
            targetType: 'entitlement',
          },
          scope: 'entitlement:ingest',
          idempotencyKey: String(request.headers['idempotency-key']),
          body: request.body,
          response: ingestEntitlementResultSchema,
        },
        (tx) => ingestEntitlement(tx, orgId, request.body),
      );
    },
  );

  app.get(
    `${base}/entitlements/:entitlementId`,
    {
      preHandler,
      schema: {
        params: orgParams.extend({ entitlementId: z.uuid() }),
        response: { 200: entitlementDetailSchema },
      },
    },
    async (request) => {
      const row = await getEntitlement(db, currentOrg(request).id, request.params.entitlementId);
      if (!row) throw notFound('Entitlement');
      return row;
    },
  );

  done();
};
