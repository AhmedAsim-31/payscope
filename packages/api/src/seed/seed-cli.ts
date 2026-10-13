import { createCredentialsCipher, decodeCredentialsKey } from '../crypto/credentials-cipher';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { runSeed } from './run-seed';
import { assertSeedAllowed } from './seed-guard';

const databaseUrl = process.env.DATABASE_URL;
const keyBase64 = process.env.CREDENTIALS_ENCRYPTION_KEY;
const key = keyBase64 ? decodeCredentialsKey(keyBase64) : undefined;
if (!databaseUrl || !key) {
  console.error('DATABASE_URL and a 32-byte base64 CREDENTIALS_ENCRYPTION_KEY are required');
  process.exit(1);
}

const { db, sql } = createDb(databaseUrl, { max: 3 });
try {
  assertSeedAllowed(databaseUrl, process.env);
  if (process.argv.includes('--migrate')) await runMigrations(databaseUrl);
  const reset = process.argv.includes('--reset');
  const summary = await runSeed(db, createCredentialsCipher(key), { reset });
  console.log(`demo seed complete${reset ? ' (reset first)' : ''}`);
  console.log(JSON.stringify(summary, null, 2));
} catch (err) {
  console.error('demo seed failed', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
