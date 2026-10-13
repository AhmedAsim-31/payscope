import {
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
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { AUDIT_ACTOR_TYPES, AUDIT_OUTCOMES } from '@payscope/shared/audit-schemas';
import { INCIDENT_STATUSES } from '@payscope/shared/incident-schemas';
import { organizationsTable } from './identity';
import { findingSeverity } from './reconciliation';

export const auditActorType = pgEnum('audit_actor_type', AUDIT_ACTOR_TYPES);
export const auditOutcome = pgEnum('audit_outcome', AUDIT_OUTCOMES);
export const incidentStatus = pgEnum('incident_status', INCIDENT_STATUSES);

const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizationsTable.id, { onDelete: 'cascade' });

export const auditLogsTable = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    actorId: uuid('actor_id'),
    actorType: auditActorType('actor_type').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    reason: text('reason'),
    previousState: jsonb('previous_state'),
    resultingState: jsonb('resulting_state'),
    outcome: auditOutcome('outcome').notNull(),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_org_created_idx').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('audit_logs_org_action_idx').on(t.orgId, t.action, t.createdAt, t.id),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
).enableRLS();

export const incidentsTable = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    category: text('category').notNull(),
    severity: findingSeverity('severity').notNull(),
    status: incidentStatus('status').notNull().default('open'),
    title: text('title').notNull(),
    fingerprint: text('fingerprint').notNull(),
    related: jsonb('related').notNull().default({}),
    findingCount: integer('finding_count').notNull().default(1),
    resolutionNotes: text('resolution_notes'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    unique('incidents_org_id_id_unique').on(t.orgId, t.id),
    uniqueIndex('incidents_active_fingerprint_idx')
      .on(t.orgId, t.fingerprint)
      .where(sql`${t.status} <> 'resolved'`),
    index('incidents_org_opened_idx').on(t.orgId, t.openedAt.desc(), t.id.desc()),
  ],
).enableRLS();

export const incidentActionsTable = pgTable(
  'incident_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    incidentId: uuid('incident_id').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'incident_actions_incident_fk',
      columns: [t.orgId, t.incidentId],
      foreignColumns: [incidentsTable.orgId, incidentsTable.id],
    }).onDelete('cascade'),
    index('incident_actions_incident_idx').on(t.incidentId, t.createdAt),
  ],
).enableRLS();
