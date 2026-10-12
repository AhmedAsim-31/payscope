import { runMigrations } from '../db/migrate';
import { resetTestDatabase } from './reset-test-database';
import { TEST_DATABASE_URL } from './test-database-url';

export default async function setup() {
  await resetTestDatabase(TEST_DATABASE_URL);
  await runMigrations(TEST_DATABASE_URL);
}
