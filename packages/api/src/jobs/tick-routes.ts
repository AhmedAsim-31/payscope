import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { ApiHttpError } from '../http-error';
import type { Worker } from './worker';

type Options = { worker: Worker; token: string };

const digest = (value: string) => createHash('sha256').update(value).digest();

export const tickRoutes: FastifyPluginCallbackZod<Options> = (app, { worker, token }, done) => {
  const expected = digest(token);
  app.post('/internal/tick', async (request) => {
    const provided = request.headers['x-internal-token'];
    if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), expected)) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'Invalid internal token');
    }
    const recovered = await worker.recover();
    const { claimed } = await worker.drainOnce();
    return { claimed, recovered };
  });
  done();
};
