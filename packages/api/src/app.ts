import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from './error-handler';
import { healthRoutes, type ReadinessCheck } from './health-routes';
import { authenticatePlugin } from './auth/authenticate';
import { meRoutes } from './auth/me-routes';
import type { TokenVerifier } from './auth/token-verifier';
import { connectionRoutes } from './connections/connection-routes';
import type { CredentialsCipher } from './crypto/credentials-cipher';
import type { Db } from './db/client';
import { pgRateLimitStore } from './rate-limit/pg-rate-limit-store';
import { DEFAULT_POLICIES, type RatePolicies } from './rate-limit/policies';
import { rateLimitPlugin } from './rate-limit/rate-limit-plugin';
import { tickRoutes } from './jobs/tick-routes';
import type { Worker } from './jobs/worker';
import { identityRoutes } from './orgs/identity-routes';
import { eventInboxRoutes } from './events/event-inbox-routes';
import { recordsRoutes } from './records/records-routes';
import { reconciliationRoutes } from './reconciliation/reconciliation-routes';
import { createDefaultAdapterRegistry } from './providers/adapter-registry';
import { webhookRoutes } from './webhooks/webhook-routes';

export type BuildAppOptions = {
  corsOrigins?: string[];
  logger?: false;
  logLevel?: string;
  logStream?: { write: (msg: string) => void };
  trustProxy?: boolean;
  readinessChecks?: ReadinessCheck[];
  tokenVerifier?: TokenVerifier;
  db?: Db;
  credentialsCipher?: CredentialsCipher;
  adapters?: AdapterRegistry;
  worker?: Worker;
  internalTickToken?: string;
  rateLimits?: RatePolicies;
};

const BODY_LIMIT_BYTES = 1024 * 1024;

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["stripe-signature"]',
  'req.headers["paddle-signature"]',
  'req.headers["paypal-transmission-sig"]',
  'req.headers["x-revenuecat-webhook-signature"]',
];

function genReqId(req: { headers: Record<string, string | string[] | undefined> }) {
  const incoming = z.uuid().safeParse(req.headers['x-request-id']);
  return incoming.success ? incoming.data : randomUUID();
}

export async function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: opts.logLevel ?? 'info',
            stream: opts.logStream,
            redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
          },
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: opts.trustProxy ?? false,
    requestIdHeader: false,
    genReqId,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet);
  await app.register(cors, { origin: opts.corsOrigins ?? [], credentials: true });
  await app.register(sensible);
  await app.register(rateLimitPlugin, {
    policies: opts.rateLimits ?? DEFAULT_POLICIES,
    ...(opts.db ? { store: pgRateLimitStore({ db: opts.db, logger: app.log }) } : {}),
  });
  await app.register(healthRoutes, { readinessChecks: opts.readinessChecks ?? [] });
  if (opts.tokenVerifier) {
    await app.register(authenticatePlugin, { tokenVerifier: opts.tokenVerifier });
    await app.register(meRoutes, { prefix: '/api/v1' });
    if (opts.db) await app.register(identityRoutes, { db: opts.db });
    if (opts.db) await app.register(recordsRoutes, { db: opts.db });
    if (opts.db) await app.register(eventInboxRoutes, { db: opts.db });
    if (opts.db && opts.credentialsCipher) {
      await app.register(connectionRoutes, { db: opts.db, cipher: opts.credentialsCipher });
      await app.register(reconciliationRoutes, {
        db: opts.db,
        cipher: opts.credentialsCipher,
        adapters: opts.adapters ?? createDefaultAdapterRegistry(),
      });
    }
  }
  if (opts.db && opts.credentialsCipher) {
    await app.register(webhookRoutes, {
      db: opts.db,
      cipher: opts.credentialsCipher,
      adapters: opts.adapters ?? createDefaultAdapterRegistry(),
    });
  }
  if (opts.worker && opts.internalTickToken) {
    await app.register(tickRoutes, { worker: opts.worker, token: opts.internalTickToken });
  }

  return app;
}
