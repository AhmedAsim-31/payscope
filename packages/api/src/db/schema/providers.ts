import {
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
  customType,
} from 'drizzle-orm/pg-core';
import { PROVIDER_NAMES } from '@payscope/provider-adapters/provider-name';
import { organizationsTable } from './identity';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const providerName = pgEnum('provider', PROVIDER_NAMES);
export const connectionMode = pgEnum('connection_mode', ['sandbox', 'simulation']);
export const connectionStatus = pgEnum('connection_status', [
  'active',
  'unverified',
  'error',
  'disabled',
]);

export const providerConnectionsTable = pgTable(
  'provider_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    provider: providerName('provider').notNull(),
    mode: connectionMode('mode').notNull(),
    status: connectionStatus('status').notNull(),
    displayName: text('display_name').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    credentialsCiphertext: bytea('credentials_ciphertext'),
    credentialsKeyVersion: integer('credentials_key_version'),
    capabilities: jsonb('capabilities').notNull().default({}),
    entitlementMap: jsonb('entitlement_map').notNull().default({}),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('provider_connections_org_id_id_unique').on(t.orgId, t.id),
    unique('provider_connections_org_provider_account_unique').on(
      t.orgId,
      t.provider,
      t.externalAccountId,
    ),
  ],
).enableRLS();

export const customersTable = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    email: text('email'),
    displayName: text('display_name'),
    externalRef: text('external_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('customers_org_id_id_unique').on(t.orgId, t.id),
    index('customers_org_created_idx').on(t.orgId, t.createdAt, t.id),
  ],
).enableRLS();

export const providerCustomerMappingsTable = pgTable(
  'provider_customer_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    providerCustomerId: text('provider_customer_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'provider_customer_mappings_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [providerConnectionsTable.orgId, providerConnectionsTable.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'provider_customer_mappings_customer_fk',
      columns: [t.orgId, t.customerId],
      foreignColumns: [customersTable.orgId, customersTable.id],
    }).onDelete('cascade'),
    unique('provider_customer_mappings_connection_customer_unique').on(
      t.connectionId,
      t.providerCustomerId,
    ),
    index('provider_customer_mappings_customer_idx').on(t.customerId),
    index('provider_customer_mappings_org_provider_customer_idx').on(t.orgId, t.providerCustomerId),
  ],
).enableRLS();
