import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/client';
import { ApiHttpError } from '../http-error';
import { scheduleDueRuns } from '../reconciliation/run-scheduler';
import { pruneExpired, type RetentionPolicy } from '../retention/retention-prune';
import type { Worker } from './worker';

type Options = {
  worker: Worker;
  token: string;
  db?: Db;
  reconciliationIntervalHours: number;
  retention: RetentionPolicy;
};

const digest = (value: string) => createHash('sha256').update(value).digest();

export const tickRoutes: FastifyPluginCallbackZod<Options> = (
  app,
  { worker, token, db, reconciliationIntervalHours, retention },
  done,
) => {
  const expected = digest(token);
  app.post('/internal/tick', { onRequest: app.rateLimitFor('internalTick') }, async (request) => {
    const provided = request.headers['x-internal-token'];
    if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), expected)) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'Invalid internal token');
    }
    const recovered = await worker.recover();
    const scheduled =
      db && reconciliationIntervalHours > 0
        ? await scheduleDueRuns(db, reconciliationIntervalHours)
        : 0;
    const pruned = db ? await pruneExpired(db, retention) : undefined;
    const { claimed } = await worker.drainOnce();
    return { claimed, recovered, scheduled, pruned };
  });
  done();
};
