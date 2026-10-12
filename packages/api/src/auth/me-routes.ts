import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const meSchema = z.object({ userId: z.uuid(), email: z.string().nullable() });

export const meRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/me',
    { preHandler: app.authenticate, schema: { response: { 200: meSchema } } },
    (request) => {
      const auth = request.auth;
      if (!auth) throw new Error('authenticate preHandler did not run');
      return { userId: auth.userId, email: auth.email ?? null };
    },
  );
  done();
};
