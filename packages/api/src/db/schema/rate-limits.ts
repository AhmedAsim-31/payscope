import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const rateLimitBucketsTable = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
}).enableRLS();
