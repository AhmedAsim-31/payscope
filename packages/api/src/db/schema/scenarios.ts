import { index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { SCENARIO_RUN_STATUSES } from '@payscope/shared/scenario-schemas';
import { organizationsTable } from './identity';

export const scenarioRunStatus = pgEnum('scenario_run_status', SCENARIO_RUN_STATUSES);

export const demoScenarioRunsTable = pgTable(
  'demo_scenario_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    scenarioId: text('scenario_id').notNull(),
    status: scenarioRunStatus('status').notNull().default('running'),
    startedBy: uuid('started_by'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    result: jsonb('result'),
  },
  (t) => [
    unique('demo_scenario_runs_org_id_id_unique').on(t.orgId, t.id),
    index('demo_scenario_runs_org_scenario_idx').on(t.orgId, t.scenarioId, t.startedAt.desc()),
  ],
).enableRLS();
