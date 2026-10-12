import { z } from 'zod';
import { PROVIDER_NAMES } from './provider-name';

export const NORMALIZED_EVENT_TYPES = [
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'payment.disputed',
  'dispute.closed',
  'subscription.created',
  'subscription.updated',
  'subscription.renewed',
  'subscription.canceled',
  'subscription.expired',
  'entitlement.granted',
  'entitlement.revoked',
  'unsupported',
] as const;

export type NormalizedEventType = (typeof NORMALIZED_EVENT_TYPES)[number];

export const OBJECT_TYPES = [
  'payment',
  'subscription',
  'entitlement',
  'customer',
  'dispute',
  'other',
] as const;

export const NormalizedEventSchema = z.object({
  provider: z.enum(PROVIDER_NAMES),
  providerEventId: z.string().min(1),
  eventType: z.string().min(1),
  normalizedType: z.enum(NORMALIZED_EVENT_TYPES),
  occurredAt: z.date(),
  objectType: z.enum(OBJECT_TYPES),
  objectId: z.string().min(1),
  providerCustomerId: z.string().min(1).nullable(),
  amountMinor: z.bigint().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  status: z.string().nullable(),
  entitlementKeys: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
