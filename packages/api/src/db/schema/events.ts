import {
  boolean,
  check,
  foreignKey,
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
import { backgroundJobsTable } from './jobs';
import { providerConnectionsTable, providerName } from './providers';

export const eventStatus = pgEnum('event_status', [
  'pending',
  'processing',
  'processed',
  'failed',
  'duplicate',
  'needs_attention',
  'ignored',
]);
export const attemptOutcome = pgEnum('attempt_outcome', ['succeeded', 'failed', 'skipped']);
export const failureCategory = pgEnum('failure_category', [
  'transient',
  'permanent',
  'invalid_input',
  'provider_auth',
  'unsupported_event',
  'state_conflict',
]);

export const providerEventsTable = pgTable(
  'provider_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull(),
    provider: providerName('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    normalizedType: text('normalized_type'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    status: eventStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    signatureVerified: boolean('signature_verified').notNull(),
    payload: jsonb('payload').notNull(),
    objectRef: text('object_ref'),
    payloadPrunedAt: timestamp('payload_pruned_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'provider_events_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [providerConnectionsTable.orgId, providerConnectionsTable.id],
    }),
    unique('provider_events_connection_event_unique').on(t.connectionId, t.providerEventId),
    unique('provider_events_org_id_id_unique').on(t.orgId, t.id),
    check('provider_events_payload_size_check', sql`pg_column_size(${t.payload}) <= 262144`),
    index('provider_events_org_received_idx').on(t.orgId, t.receivedAt, t.id),
    index('provider_events_org_status_idx').on(t.orgId, t.status, t.receivedAt, t.id),
    index('provider_events_object_ref_idx').on(
      t.orgId,
      t.connectionId,
      t.objectRef,
      t.receivedAt,
      t.id,
    ),
    index('provider_events_payload_retention_idx')
      .on(t.receivedAt)
      .where(
        sql`${t.payloadPrunedAt} IS NULL AND ${t.status} IN ('processed', 'duplicate', 'ignored')`,
      ),
  ],
).enableRLS();

export const eventProcessingAttemptsTable = pgTable(
  'event_processing_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    jobId: uuid('job_id'),
    attemptNumber: integer('attempt_number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    outcome: attemptOutcome('outcome'),
    failureCategory: failureCategory('failure_category'),
    errorMessage: text('error_message'),
    retryable: boolean('retryable'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    correlationId: text('correlation_id'),
  },
  (t) => [
    foreignKey({
      name: 'event_processing_attempts_event_fk',
      columns: [t.orgId, t.eventId],
      foreignColumns: [providerEventsTable.orgId, providerEventsTable.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'event_processing_attempts_job_fk',
      columns: [t.orgId, t.jobId],
      foreignColumns: [backgroundJobsTable.orgId, backgroundJobsTable.id],
    }),
    unique('event_processing_attempts_event_attempt_unique').on(t.eventId, t.attemptNumber),
    index('event_processing_attempts_job_idx')
      .on(t.jobId)
      .where(sql`${t.jobId} IS NOT NULL`),
  ],
).enableRLS();
