import { z } from 'zod';
import { CAPABILITY_NAMES, CAPABILITY_STATUSES } from '@payscope/provider-adapters/capabilities';
import { PROVIDER_NAMES } from '@payscope/provider-adapters/provider-name';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { providerConnectionsTable } from '../db/schema/providers';
import { createDefaultAdapterRegistry } from '../providers/adapter-registry';
import { entitlementMapSchema } from './entitlement-map';

const adapters = createDefaultAdapterRegistry();

export const connectionViewSchema = z.object({
  id: z.uuid(),
  provider: z.enum(PROVIDER_NAMES),
  mode: z.enum(['sandbox', 'simulation']),
  status: z.enum(['active', 'unverified', 'error', 'disabled']),
  displayName: z.string(),
  externalAccountId: z.string(),
  hasWebhookSecret: z.boolean(),
  hasApiKey: z.boolean(),
  webhookUrl: z.string(),
  capabilities: z.record(z.enum(CAPABILITY_NAMES), z.enum(CAPABILITY_STATUSES)),
  entitlementMap: entitlementMapSchema,
  lastVerifiedAt: z.date().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ConnectionRow = Pick<
  typeof providerConnectionsTable.$inferSelect,
  | 'id'
  | 'provider'
  | 'mode'
  | 'status'
  | 'displayName'
  | 'externalAccountId'
  | 'credentialsCiphertext'
  | 'entitlementMap'
  | 'lastVerifiedAt'
  | 'lastError'
  | 'createdAt'
  | 'updatedAt'
>;

export function toConnectionView(row: ConnectionRow, cipher: CredentialsCipher) {
  const credentials = row.credentialsCiphertext
    ? cipher.decrypt(row.credentialsCiphertext, row.id)
    : undefined;
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    status: row.status,
    displayName: row.displayName,
    externalAccountId: row.externalAccountId,
    hasWebhookSecret: (credentials?.webhookSecrets.length ?? 0) > 0,
    hasApiKey: credentials?.apiKey !== undefined,
    webhookUrl: `/webhooks/${row.provider}/${row.id}`,
    capabilities: adapters.get(row.provider).capabilities,
    entitlementMap: entitlementMapSchema.catch({}).parse(row.entitlementMap),
    lastVerifiedAt: row.lastVerifiedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
