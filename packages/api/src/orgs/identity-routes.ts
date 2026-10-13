import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/client';
import { ensureProfile } from './profile-service';
import { orgRoutes } from './org-routes';
import { memberRoutes } from './member-routes';

export const identityRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());
  app.addHook('preHandler', async (request) => {
    if (request.auth) await ensureProfile(db, request.auth);
  });
  app.register(orgRoutes, { db });
  app.register(memberRoutes, { db });
  done();
};
