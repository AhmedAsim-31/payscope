import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';

/** Supabase-managed table for FK references; excluded from migrations by schemaFilter. */
export const authUsers = pgSchema('auth').table('users', {
  id: uuid('id').primaryKey(),
  email: text('email'),
});
