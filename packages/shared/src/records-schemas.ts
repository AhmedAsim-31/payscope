import { z } from 'zod';

export const RECORD_PROVIDERS = ['stripe', 'paddle', 'paypal', 'revenuecat'] as const;
export const PAYMENT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
  'disputed',
  'canceled',
] as const;
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
  'paused',
] as const;
export const ENTITLEMENT_STATES = ['active', 'expired', 'revoked', 'inconsistent'] as const;
export const ENTITLEMENT_SOURCES = [
  'provider_event',
  'reconciliation',
  'manual_repair',
  'scenario',
  'ingestion_api',
] as const;

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

const providerSchema = z.enum(RECORD_PROVIDERS);
const isoDate = z.iso.datetime();
const nullableDate = isoDate.nullable();

export const moneySchema = z.object({
  amountMinor: z.string().regex(/^-?\d+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof moneySchema>;

const customerRefSchema = z.object({ id: z.uuid(), email: z.string().nullable() });

function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const paymentSchema = z.object({
  id: z.uuid(),
  provider: providerSchema,
  connectionId: z.uuid(),
  providerPaymentId: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  amount: moneySchema,
  amountRefunded: moneySchema,
  customer: customerRefSchema.nullable(),
  providerCreatedAt: nullableDate,
  createdAt: isoDate,
});
export type Payment = z.infer<typeof paymentSchema>;

export const relatedEventSchema = z.object({
  id: z.uuid(),
  eventType: z.string(),
  normalizedType: z.string().nullable(),
  status: z.string(),
  occurredAt: isoDate,
  receivedAt: isoDate,
});
export type RelatedEvent = z.infer<typeof relatedEventSchema>;

export const paymentDetailSchema = paymentSchema.extend({
  lastEventAt: nullableDate,
  updatedAt: isoDate,
  events: z.array(relatedEventSchema),
});
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;
export const paymentPageSchema = page(paymentSchema);

export const subscriptionSchema = z.object({
  id: z.uuid(),
  provider: providerSchema,
  connectionId: z.uuid(),
  providerSubscriptionId: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  planRef: z.string().nullable(),
  currentPeriodStart: nullableDate,
  currentPeriodEnd: nullableDate,
  cancelAtPeriodEnd: z.boolean(),
  customer: customerRefSchema,
  createdAt: isoDate,
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const entitlementSchema = z.object({
  id: z.uuid(),
  entitlementKey: z.string(),
  state: z.enum(ENTITLEMENT_STATES),
  source: z.enum(ENTITLEMENT_SOURCES),
  customer: customerRefSchema,
  subscriptionId: z.uuid().nullable(),
  grantedAt: nullableDate,
  expiresAt: nullableDate,
  revokedAt: nullableDate,
  reconciliationStatus: z.string().nullable(),
  createdAt: isoDate,
});
export type Entitlement = z.infer<typeof entitlementSchema>;

export const subscriptionDetailSchema = subscriptionSchema.extend({
  lastEventAt: nullableDate,
  updatedAt: isoDate,
  entitlements: z.array(entitlementSchema),
});
export type SubscriptionDetail = z.infer<typeof subscriptionDetailSchema>;
export const subscriptionPageSchema = page(subscriptionSchema);

export const entitlementDetailSchema = entitlementSchema.extend({ updatedAt: isoDate });
export type EntitlementDetail = z.infer<typeof entitlementDetailSchema>;
export const entitlementPageSchema = page(entitlementSchema);

export const customerSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  externalRef: z.string().nullable(),
  createdAt: isoDate,
});
export type Customer = z.infer<typeof customerSchema>;
export const customerPageSchema = page(customerSchema);

export const customerMappingSchema = z.object({
  provider: providerSchema,
  connectionId: z.uuid(),
  providerCustomerId: z.string(),
});

export const customerDetailSchema = customerSchema.extend({
  updatedAt: isoDate,
  mappings: z.array(customerMappingSchema),
  subscriptions: z.array(subscriptionSchema.omit({ customer: true })),
  entitlements: z.array(entitlementSchema.omit({ customer: true })),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

const PG_BIGINT_MAX = 9223372036854775807n;

const minorAmountQuerySchema = z
  .string()
  .regex(/^\d+$/)
  .transform(BigInt)
  .pipe(z.bigint().max(PG_BIGINT_MAX));

const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .transform((n) => Math.min(n, MAX_PAGE_LIMIT))
  .default(DEFAULT_PAGE_LIMIT);

export const pageQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: limitSchema,
});

export const paymentQuerySchema = pageQuerySchema.extend({
  status: z.enum(PAYMENT_STATUSES).optional(),
  provider: providerSchema.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  connectionId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  minAmount: minorAmountQuerySchema.optional(),
  maxAmount: minorAmountQuerySchema.optional(),
  customerId: z.uuid().optional(),
  subscriptionId: z.uuid().optional(),
});

export const subscriptionQuerySchema = pageQuerySchema.extend({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  provider: providerSchema.optional(),
  customerId: z.uuid().optional(),
});

export const customerQuerySchema = pageQuerySchema.extend({
  email: z.string().trim().min(1).max(100).optional(),
});

export const entitlementQuerySchema = pageQuerySchema.extend({
  state: z.enum(ENTITLEMENT_STATES).optional(),
  customerId: z.uuid().optional(),
  key: z.string().trim().min(1).max(100).optional(),
});
