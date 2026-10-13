import { z } from 'zod';

export const REPAIR_REASON_MIN = 10;
export const REPAIR_REASON_MAX = 500;
export const CORRECTABLE_FINDING_TYPES = [
  'entitlement_missing_or_stale',
  'expired_externally_active_locally',
] as const;

export const reasonSchema = z.string().trim().min(REPAIR_REASON_MIN).max(REPAIR_REASON_MAX);

export const repairHeadersSchema = z.object({
  'idempotency-key': z.string().min(8).max(128),
});

export const reprocessEventBodySchema = z.object({ eventId: z.uuid(), reason: reasonSchema });
export const correctEntitlementBodySchema = z.object({ findingId: z.uuid(), reason: reasonSchema });
export const resolveFindingBodySchema = z.object({ findingId: z.uuid(), reason: reasonSchema });
export const refreshFromProviderBodySchema = z.union([
  z.strictObject({ paymentId: z.uuid(), reason: reasonSchema }),
  z.strictObject({ subscriptionId: z.uuid(), reason: reasonSchema }),
]);

export const repairResultSchema = z.object({
  action: z.enum([
    'reprocess_event',
    'correct_entitlement',
    'resolve_finding',
    'refresh_from_provider',
  ]),
  targetId: z.uuid(),
  previousState: z.record(z.string(), z.unknown()),
  resultingState: z.record(z.string(), z.unknown()),
});
export type RepairResult = z.infer<typeof repairResultSchema>;
