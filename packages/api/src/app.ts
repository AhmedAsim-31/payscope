import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from './error-handler';
import { healthRoutes, type ReadinessCheck } from './health-routes';

export type BuildAppOptions = {
  corsOrigins?: string[];
  logger?: false;
  logLevel?: string;
  trustProxy?: boolean;
  readinessChecks?: ReadinessCheck[];
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
  await app.register(healthRoutes, { readinessChecks: opts.readinessChecks ?? [] });

  return app;
}
