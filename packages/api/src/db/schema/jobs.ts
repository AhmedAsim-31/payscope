import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizationsTable } from './identity';

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'dead']);

export const backgroundJobsTable = pgTable(
  'background_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').references(() => organizationsTable.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: jobStatus('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('background_jobs_org_id_id_unique').on(t.orgId, t.id),
    check('background_jobs_attempts_check', sql`${t.attemptCount} >= 0 AND ${t.maxAttempts} >= 1`),
    index('background_jobs_queued_idx')
      .on(t.availableAt)
      .where(sql`${t.status} = 'queued'`),
    index('background_jobs_running_lease_idx')
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} = 'running'`),
    index('background_jobs_finished_retention_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} IN ('succeeded', 'failed', 'dead')`),
  ],
).enableRLS();

export const idempotencyRecordsTable = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_records_org_scope_key_unique').on(t.orgId, t.scope, t.key),
    index('idempotency_records_expires_idx').on(t.expiresAt),
  ],
).enableRLS();
