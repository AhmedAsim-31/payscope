import { z } from 'zod';
import { runMigrations } from './migrate';

const parsed = z.string().min(1).safeParse(process.env.DATABASE_URL);
if (!parsed.success) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

try {
  await runMigrations(parsed.data);
  console.log('migrations applied');
} catch (err) {
  console.error('migration failed', err);
  process.exit(1);
}
