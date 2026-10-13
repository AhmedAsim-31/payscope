import { loadConfig } from './config';
import { createCredentialsCipher } from './crypto/credentials-cipher';
import { createDb } from './db/client';
import { createDefaultHandlers } from './jobs/default-handlers';
import { createJsonLogger } from './jobs/json-logger';
import { createWorker } from './jobs/worker';
import { createDefaultAdapterRegistry } from './providers/adapter-registry';

const config = loadConfig();
const logger = createJsonLogger();
const { db, sql } = createDb(config.databaseUrl, { max: config.dbPoolMax });
const worker = createWorker({
  db,
  handlers: createDefaultHandlers(
    createDefaultAdapterRegistry(),
    config.credentialsKey
      ? createCredentialsCipher(config.credentialsKey, {
          version: config.credentialsKeyVersion,
          previous: config.credentialsPreviousKeys,
        })
      : undefined,
  ),
  logger,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'worker_shutting_down');
    worker
      .stop()
      .then(() => sql.end())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          logger.error({ err: String(err) }, 'worker_shutdown_failed');
          process.exit(1);
        },
      );
  });
}

worker.start();
logger.info({ workerId: worker.workerId }, 'worker_started');
