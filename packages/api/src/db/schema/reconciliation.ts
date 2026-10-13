import {
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  FINDING_TYPES,
  RUN_MODES,
  RUN_STATUSES,
  RUN_TRIGGERS,
} from '@payscope/shared/reconciliation-schemas';
import { organizationsTable } from './identity';
import { providerConnectionsTable } from './providers';

export const reconciliationRunStatus = pgEnum('reconciliation_run_status', RUN_STATUSES);
export const reconciliationMode = pgEnum('reconciliation_mode', RUN_MODES);
export const reconciliationTrigger = pgEnum('reconciliation_trigger', RUN_TRIGGERS);
export const findingType = pgEnum('finding_type', FINDING_TYPES);
export const findingSeverity = pgEnum('finding_severity', FINDING_SEVERITIES);
export const findingStatus = pgEnum('finding_status', FINDING_STATUSES);

const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizationsTable.id, { onDelete: 'cascade' });

export const reconciliationRunsTable = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    connectionId: uuid('connection_id'),
    status: reconciliationRunStatus('status').notNull().default('running'),
    mode: reconciliationMode('mode').notNull(),
    trigger: reconciliationTrigger('trigger').notNull().default('manual'),
    scope: jsonb('scope').notNull().default({}),
    checkpoint: jsonb('checkpoint').notNull().default({}),
    examinedCount: integer('examined_count').notNull().default(0),
    matchedCount: integer('matched_count').notNull().default(0),
    mismatchedCount: integer('mismatched_count').notNull().default(0),
    unavailableCount: integer('unavailable_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    triggeredBy: uuid('triggered_by'),
  },
  (t) => [
    foreignKey({
      name: 'reconciliation_runs_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [providerConnectionsTable.orgId, providerConnectionsTable.id],
    }).onDelete('cascade'),
    unique('reconciliation_runs_org_id_id_unique').on(t.orgId, t.id),
    uniqueIndex('reconciliation_runs_one_running_idx')
      .on(t.orgId, sql`coalesce(${t.connectionId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.status} = 'running'`),
    check(
      'reconciliation_runs_counts_check',
      sql`${t.examinedCount} >= 0 AND ${t.matchedCount} >= 0 AND ${t.mismatchedCount} >= 0 AND ${t.unavailableCount} >= 0 AND ${t.failedCount} >= 0`,
    ),
    index('reconciliation_runs_org_started_idx').on(t.orgId, t.startedAt, t.id),
  ],
).enableRLS();

export const reconciliationFindingsTable = pgTable(
  'reconciliation_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    type: findingType('type').notNull(),
    severity: findingSeverity('severity').notNull(),
    status: findingStatus('status').notNull().default('open'),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    recommendedAction: text('recommended_action').notNull(),
    firstSeenRunId: uuid('first_seen_run_id').notNull(),
    lastSeenRunId: uuid('last_seen_run_id').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'reconciliation_findings_first_run_fk',
      columns: [t.orgId, t.firstSeenRunId],
      foreignColumns: [reconciliationRunsTable.orgId, reconciliationRunsTable.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reconciliation_findings_last_run_fk',
      columns: [t.orgId, t.lastSeenRunId],
      foreignColumns: [reconciliationRunsTable.orgId, reconciliationRunsTable.id],
    }).onDelete('cascade'),
    unique('reconciliation_findings_org_id_id_unique').on(t.orgId, t.id),
    uniqueIndex('reconciliation_findings_open_fingerprint_idx')
      .on(t.orgId, t.fingerprint)
      .where(sql`${t.status} IN ('open', 'reviewed')`),
    index('reconciliation_findings_org_created_idx').on(t.orgId, t.createdAt, t.id),
    index('reconciliation_findings_org_status_idx').on(t.orgId, t.status, t.createdAt, t.id),
    index('reconciliation_findings_org_subject_idx').on(t.orgId, t.subjectType, t.subjectId),
  ],
).enableRLS();
