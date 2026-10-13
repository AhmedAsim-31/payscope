import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { createCredentialsCipher } from './credentials-cipher';
import { rotateCredentials } from './rotate-credentials';

const config = loadConfig();
if (!config.credentialsKey) {
  console.error('CREDENTIALS_ENCRYPTION_KEY is required');
  process.exit(1);
}

const cipher = createCredentialsCipher(config.credentialsKey, {
  version: config.credentialsKeyVersion,
  previous: config.credentialsPreviousKeys,
});
const { db, sql } = createDb(config.databaseUrl, { max: 2 });
try {
  const summary = await rotateCredentials(db, cipher, config.credentialsKeyVersion);
  console.log(JSON.stringify(summary));
  if (summary.failed.length > 0) process.exitCode = 1;
} finally {
  await sql.end();
}
