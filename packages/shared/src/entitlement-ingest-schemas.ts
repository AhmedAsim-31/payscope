import { z } from 'zod';
import { entitlementDetailSchema } from './records-schemas';

export const entitlementKeySchema = z.string().regex(/^[a-z0-9_.:-]{1,64}$/);

export const INGESTIBLE_ENTITLEMENT_STATES = ['active', 'expired', 'revoked'] as const;

export const ingestEntitlementBodySchema = z.object({
  customerId: z.uuid(),
  entitlementKey: entitlementKeySchema,
  state: z.enum(INGESTIBLE_ENTITLEMENT_STATES),
  subscriptionId: z.uuid().optional(),
  observedAt: z.iso.datetime(),
  grantedAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
  revokedAt: z.iso.datetime().optional(),
});
export type IngestEntitlementBody = z.infer<typeof ingestEntitlementBodySchema>;

export const ingestEntitlementResultSchema = z.object({
  applied: z.boolean(),
  entitlement: entitlementDetailSchema,
});
export type IngestEntitlementResult = z.infer<typeof ingestEntitlementResultSchema>;
