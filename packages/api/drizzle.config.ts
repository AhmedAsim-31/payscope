import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  schemaFilter: ['public'],
  out: '../../supabase/migrations',
  migrations: { prefix: 'supabase' },
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
