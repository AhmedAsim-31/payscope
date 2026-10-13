import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizationsTable } from './identity';
import { customersTable, providerConnectionsTable } from './providers';

export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
  'disputed',
  'canceled',
]);
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
  'paused',
]);
export const entitlementState = pgEnum('entitlement_state', [
  'active',
  'expired',
  'revoked',
  'inconsistent',
]);
export const entitlementSource = pgEnum('entitlement_source', [
  'provider_event',
  'reconciliation',
  'manual_repair',
  'scenario',
]);

const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizationsTable.id, { onDelete: 'cascade' });
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentRecordsTable = pgTable(
  'payment_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    connectionId: uuid('connection_id').notNull(),
    customerId: uuid('customer_id'),
    providerPaymentId: text('provider_payment_id').notNull(),
    providerSubscriptionId: text('provider_subscription_id'),
    status: paymentStatus('status').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    amountRefundedMinor: bigint('amount_refunded_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    currency: char('currency', { length: 3 }).notNull(),
    providerCreatedAt: timestamp('provider_created_at', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'payment_records_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [providerConnectionsTable.orgId, providerConnectionsTable.id],
    }),
    foreignKey({
      name: 'payment_records_customer_fk',
      columns: [t.orgId, t.customerId],
      foreignColumns: [customersTable.orgId, customersTable.id],
    }),
    unique('payment_records_connection_payment_unique').on(t.connectionId, t.providerPaymentId),
    unique('payment_records_org_id_id_unique').on(t.orgId, t.id),
    check('payment_records_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('payment_records_amount_check', sql`${t.amountMinor} >= 0`),
    check(
      'payment_records_refunded_check',
      sql`${t.amountRefundedMinor} >= 0 AND ${t.amountRefundedMinor} <= ${t.amountMinor}`,
    ),
    index('payment_records_org_created_idx').on(t.orgId, t.createdAt, t.id),
    index('payment_records_org_status_idx').on(t.orgId, t.status, t.createdAt, t.id),
  ],
).enableRLS();

export const subscriptionRecordsTable = pgTable(
  'subscription_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    connectionId: uuid('connection_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    status: subscriptionStatus('status').notNull(),
    planRef: text('plan_ref'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'subscription_records_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [providerConnectionsTable.orgId, providerConnectionsTable.id],
    }),
    foreignKey({
      name: 'subscription_records_customer_fk',
      columns: [t.orgId, t.customerId],
      foreignColumns: [customersTable.orgId, customersTable.id],
    }),
    unique('subscription_records_connection_subscription_unique').on(
      t.connectionId,
      t.providerSubscriptionId,
    ),
    unique('subscription_records_org_id_id_unique').on(t.orgId, t.id),
    index('subscription_records_org_created_idx').on(t.orgId, t.createdAt, t.id),
    index('subscription_records_org_status_idx').on(t.orgId, t.status, t.createdAt, t.id),
  ],
).enableRLS();

export const entitlementRecordsTable = pgTable(
  'entitlement_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgId(),
    customerId: uuid('customer_id').notNull(),
    subscriptionId: uuid('subscription_id'),
    entitlementKey: text('entitlement_key').notNull(),
    state: entitlementState('state').notNull(),
    source: entitlementSource('source').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    reconciliationStatus: text('reconciliation_status'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'entitlement_records_customer_fk',
      columns: [t.orgId, t.customerId],
      foreignColumns: [customersTable.orgId, customersTable.id],
    }),
    foreignKey({
      name: 'entitlement_records_subscription_fk',
      columns: [t.orgId, t.subscriptionId],
      foreignColumns: [subscriptionRecordsTable.orgId, subscriptionRecordsTable.id],
    }),
    unique('entitlement_records_customer_key_unique').on(t.orgId, t.customerId, t.entitlementKey),
    index('entitlement_records_org_state_idx').on(t.orgId, t.state),
    index('entitlement_records_org_created_idx').on(t.orgId, t.createdAt, t.id),
  ],
).enableRLS();
