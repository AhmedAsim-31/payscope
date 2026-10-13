import { z } from 'zod';
import { entitlementKeySchema } from '@payscope/shared/entitlement-ingest-schemas';

const MAX_PLANS = 100;
const MAX_KEYS_PER_PLAN = 20;

export const entitlementMapSchema = z
  .record(z.string().min(1).max(200), z.array(entitlementKeySchema).max(MAX_KEYS_PER_PLAN))
  .refine((map) => Object.keys(map).length <= MAX_PLANS, {
    error: `at most ${MAX_PLANS} plans`,
  });

export type EntitlementMap = z.infer<typeof entitlementMapSchema>;
