import { z } from 'zod';

export const RevenueCatEnvelopeSchema = z.object({
  api_version: z.string().nullish(),
  event: z.looseObject({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    event_timestamp_ms: z.number().int().nonnegative(),
    environment: z.string().min(1),
    entitlement_ids: z.array(z.string().min(1)).nullish(),
    product_id: z.string().nullish(),
    original_transaction_id: z.string().min(1).nullish(),
    transaction_id: z.string().min(1).nullish(),
    currency: z.string().nullish(),
    price_in_purchased_currency: z.number().nullish(),
    store: z.string().nullish(),
    period_type: z.string().nullish(),
    cancel_reason: z.string().nullish(),
    expiration_reason: z.string().nullish(),
  }),
});

export type RevenueCatEnvelope = z.infer<typeof RevenueCatEnvelopeSchema>;
