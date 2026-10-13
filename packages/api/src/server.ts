import { createRemoteJWKSet } from 'jose';
import { buildApp } from './app';
import { createTokenVerifier } from './auth/token-verifier';
import { loadConfig } from './config';
import { createCredentialsCipher } from './crypto/credentials-cipher';
import { createDb } from './db/client';

const config = loadConfig();
const { db, sql } = createDb(config.databaseUrl, { max: config.dbPoolMax });
const app = await buildApp({
  corsOrigins: config.corsOrigins,
  logLevel: config.logLevel,
  trustProxy: config.trustProxy,
  readinessChecks: [
    {
      name: 'database',
      check: async () => {
        await sql`select 1`;
      },
    },
  ],
  db,
  credentialsCipher: config.credentialsKey
    ? createCredentialsCipher(config.credentialsKey)
    : undefined,
  tokenVerifier: createTokenVerifier({
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    keySet: createRemoteJWKSet(new URL(config.jwksUrl)),
  }),
});

if (!config.credentialsKey) {
  app.log.warn('CREDENTIALS_ENCRYPTION_KEY not set; connections API and webhook ingress disabled');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => sql.end())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          app.log.error({ err }, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
