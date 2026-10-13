import { z } from 'zod';
import { PROVIDER_NAMES } from '@payscope/provider-adapters/provider-name';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { providerConnectionsTable } from '../db/schema/providers';
import { entitlementMapSchema } from './entitlement-map';

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
  entitlementMap: entitlementMapSchema,
  lastVerifiedAt: z.date().nullable(),
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
    entitlementMap: entitlementMapSchema.catch({}).parse(row.entitlementMap),
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
