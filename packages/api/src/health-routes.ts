import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export type ReadinessCheck = { name: string; check: () => Promise<void> };

const checksSchema = z.record(z.string(), z.enum(['ok', 'fail']));

export const healthRoutes: FastifyPluginCallbackZod<{
  readinessChecks: ReadinessCheck[];
}> = (app, { readinessChecks }, done) => {
  app.get(
    '/health',
    { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/ready',
    {
      schema: {
        response: {
          200: z.object({ status: z.literal('ready'), checks: checksSchema }),
          503: z.object({ status: z.literal('not_ready'), checks: checksSchema }),
        },
      },
    },
    async (request, reply) => {
      const results = await Promise.all(
        readinessChecks.map(async ({ name, check }) => {
          try {
            await check();
            return [name, 'ok'] as const;
          } catch (err) {
            request.log.warn({ err, check: name }, 'readiness check failed');
            return [name, 'fail'] as const;
          }
        }),
      );
      const checks = Object.fromEntries(results);
      if (results.some(([, r]) => r === 'fail')) {
        return reply.code(503).send({ status: 'not_ready' as const, checks });
      }
      return { status: 'ready' as const, checks };
    },
  );

  done();
};
