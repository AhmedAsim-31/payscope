import { createRemoteJWKSet } from 'jose';
import { buildApp } from './app';
import { createTokenVerifier } from './auth/token-verifier';
import { loadConfig } from './config';

const config = loadConfig();
const app = await buildApp({
  corsOrigins: config.corsOrigins,
  logLevel: config.logLevel,
  trustProxy: config.trustProxy,
  tokenVerifier: createTokenVerifier({
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    keySet: createRemoteJWKSet(new URL(config.jwksUrl)),
  }),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
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
