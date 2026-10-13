import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api-client';

export const CONNECTION_PROVIDERS = ['stripe', 'paddle', 'paypal', 'revenuecat'] as const;
export const CONNECTION_MODES = ['sandbox', 'simulation'] as const;

const CAPABILITY_STATUSES = [
  'supported_tested',
  'implemented_unverified',
  'unsupported',
  'simulated',
] as const;

export const CAPABILITY_LABELS: Record<(typeof CAPABILITY_STATUSES)[number], string> = {
  supported_tested: 'Supported and tested',
  implemented_unverified: 'Implemented, not verified',
  unsupported: 'Not supported',
  simulated: 'Simulated',
};

export const CAPABILITY_NAMES: Record<string, string> = {
  webhookVerification: 'Webhook verification',
  eventNormalization: 'Event normalization',
  authoritativeFetch: 'Authoritative fetch',
  reconciliation: 'Reconciliation',
  credentialValidation: 'Credential validation',
  idMapping: 'ID mapping',
};

export const connectionSchema = z.object({
  id: z.uuid(),
  provider: z.enum(CONNECTION_PROVIDERS),
  mode: z.enum(CONNECTION_MODES),
  status: z.enum(['active', 'unverified', 'error', 'disabled']),
  displayName: z.string(),
  externalAccountId: z.string(),
  hasWebhookSecret: z.boolean(),
  hasApiKey: z.boolean(),
  webhookUrl: z.string(),
  capabilities: z.record(z.string(), z.enum(CAPABILITY_STATUSES)),
  lastVerifiedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});

export type Connection = z.infer<typeof connectionSchema>;
export type ConnectionProvider = Connection['provider'];

export const PROVIDER_LABELS: Record<ConnectionProvider, string> = {
  stripe: 'Stripe',
  paddle: 'Paddle',
  paypal: 'PayPal',
  revenuecat: 'RevenueCat',
};

export const connectionsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ['orgs', orgId, 'connections'],
    queryFn: async () =>
      z
        .object({ connections: z.array(connectionSchema) })
        .parse(await apiFetch(`/api/v1/orgs/${orgId}/connections`)).connections,
  });
