import { z } from 'zod';
import {
  NormalizedEventSchema,
  type NormalizedEvent,
  type NormalizedEventType,
} from '../normalized-event';
import { ProviderError } from '../provider-error';

const MinorAmount = z.number().int().safe();
const Customer = z.string().min(1).nullish();

const EnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number().int().nonnegative(),
  livemode: z.boolean(),
  api_version: z.string().nullish(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const PaymentIntentSchema = z.object({
  id: z.string().min(1),
  amount: MinorAmount,
  amount_received: MinorAmount.nullish(),
  currency: z.string().length(3),
  status: z.string().min(1),
  customer: Customer,
});

const ChargeSchema = z.object({
  id: z.string().min(1),
  payment_intent: z.string().min(1).nullish(),
  amount_refunded: MinorAmount,
  currency: z.string().length(3),
  status: z.string().min(1),
  customer: Customer,
});

const DisputeSchema = z.object({
  id: z.string().min(1),
  amount: MinorAmount,
  currency: z.string().length(3),
  status: z.string().min(1),
  charge: z.string().min(1).nullish(),
  payment_intent: z.string().min(1).nullish(),
});

const SubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  customer: Customer,
  currency: z.string().length(3).nullish(),
  cancel_at_period_end: z.boolean().nullish(),
  canceled_at: z.number().int().nullish(),
  ended_at: z.number().int().nullish(),
  items: z
    .object({
      data: z.array(
        z.object({
          current_period_end: z.number().int().nullish(),
          price: z.object({ id: z.string().min(1) }).nullish(),
        }),
      ),
    })
    .nullish(),
});

const InvoiceSchema = z.object({
  id: z.string().min(1),
  billing_reason: z.string().nullish(),
  status: z.string().nullish(),
  customer: Customer,
  currency: z.string().length(3),
  amount_paid: MinorAmount,
  parent: z
    .object({
      subscription_details: z.object({ subscription: z.string().min(1) }).nullish(),
    })
    .nullish(),
});

type Envelope = z.infer<typeof EnvelopeSchema>;
type Mapped = Pick<
  NormalizedEvent,
  | 'normalizedType'
  | 'objectType'
  | 'objectId'
  | 'providerCustomerId'
  | 'amountMinor'
  | 'currency'
  | 'status'
  | 'metadata'
>;

function parseObject<T extends z.ZodType>(schema: T, envelope: Envelope): z.infer<T> {
  const parsed = schema.safeParse(envelope.data.object);
  if (!parsed.success) {
    throw new ProviderError(
      'invalid_input',
      `Invalid Stripe ${envelope.type} object: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

const upper = (currency: string): string => currency.toUpperCase();

function mapPaymentIntent(envelope: Envelope, type: NormalizedEventType): Mapped {
  const pi = parseObject(PaymentIntentSchema, envelope);
  const settled = type === 'payment.succeeded';
  return {
    normalizedType: type,
    objectType: 'payment',
    objectId: pi.id,
    providerCustomerId: pi.customer ?? null,
    amountMinor: BigInt(settled ? (pi.amount_received ?? pi.amount) : pi.amount),
    currency: upper(pi.currency),
    status: pi.status,
    metadata: null,
  };
}

function mapRefund(envelope: Envelope): Mapped {
  const charge = parseObject(ChargeSchema, envelope);
  return {
    normalizedType: 'payment.refunded',
    objectType: 'payment',
    objectId: charge.payment_intent ?? charge.id,
    providerCustomerId: charge.customer ?? null,
    amountMinor: BigInt(charge.amount_refunded),
    currency: upper(charge.currency),
    status: charge.status,
    metadata: { chargeId: charge.id },
  };
}

function mapDispute(envelope: Envelope, type: NormalizedEventType): Mapped {
  const dispute = parseObject(DisputeSchema, envelope);
  return {
    normalizedType: type,
    objectType: 'dispute',
    objectId: dispute.id,
    providerCustomerId: null,
    amountMinor: BigInt(dispute.amount),
    currency: upper(dispute.currency),
    status: dispute.status,
    metadata: { chargeId: dispute.charge ?? null, paymentIntentId: dispute.payment_intent ?? null },
  };
}

function mapSubscription(envelope: Envelope, type: NormalizedEventType): Mapped {
  const sub = parseObject(SubscriptionSchema, envelope);
  const periodEnds = (sub.items?.data ?? []).flatMap((item) => item.current_period_end ?? []);
  const canceled = type === 'subscription.updated' && sub.status === 'canceled';
  return {
    normalizedType: canceled ? 'subscription.canceled' : type,
    objectType: 'subscription',
    objectId: sub.id,
    providerCustomerId: sub.customer ?? null,
    amountMinor: null,
    currency: sub.currency ? upper(sub.currency) : null,
    status: sub.status,
    metadata: {
      currentPeriodEnd: periodEnds.length > 0 ? Math.max(...periodEnds) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
      endedAt: sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : null,
      planId: sub.items?.data[0]?.price?.id ?? null,
    },
  };
}

function mapInvoicePaid(envelope: Envelope): Mapped | undefined {
  const invoice = parseObject(InvoiceSchema, envelope);
  if (invoice.billing_reason !== 'subscription_cycle') return undefined;
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionId) {
    throw new ProviderError('invalid_input', 'Stripe invoice.paid renewal has no subscription');
  }
  return {
    normalizedType: 'subscription.renewed',
    objectType: 'subscription',
    objectId: subscriptionId,
    providerCustomerId: invoice.customer ?? null,
    amountMinor: BigInt(invoice.amount_paid),
    currency: upper(invoice.currency),
    status: invoice.status ?? null,
    metadata: { invoiceId: invoice.id },
  };
}

function mapUnsupported(envelope: Envelope): Mapped {
  const id = envelope.data.object['id'];
  return {
    normalizedType: 'unsupported',
    objectType: 'other',
    objectId: typeof id === 'string' && id ? id : envelope.id,
    providerCustomerId: null,
    amountMinor: null,
    currency: null,
    status: null,
    metadata: null,
  };
}

function mapEvent(envelope: Envelope): Mapped {
  switch (envelope.type) {
    case 'payment_intent.succeeded':
      return mapPaymentIntent(envelope, 'payment.succeeded');
    case 'payment_intent.payment_failed':
      return mapPaymentIntent(envelope, 'payment.failed');
    case 'charge.refunded':
      return mapRefund(envelope);
    case 'charge.dispute.created':
      return mapDispute(envelope, 'payment.disputed');
    case 'charge.dispute.closed':
      return mapDispute(envelope, 'dispute.closed');
    case 'customer.subscription.created':
      return mapSubscription(envelope, 'subscription.created');
    case 'customer.subscription.updated':
      return mapSubscription(envelope, 'subscription.updated');
    case 'customer.subscription.deleted':
      return mapSubscription(envelope, 'subscription.expired');
    case 'invoice.paid':
      return mapInvoicePaid(envelope) ?? mapUnsupported(envelope);
    default:
      return mapUnsupported(envelope);
  }
}

export function normalizeStripeEvent(payload: unknown): NormalizedEvent {
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProviderError(
      'invalid_input',
      `Invalid Stripe event envelope: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  const envelope = parsed.data;
  if (envelope.livemode) {
    throw new ProviderError('invalid_input', 'Live-mode Stripe events are not allowed', {
      reason: 'live_mode',
    });
  }
  return NormalizedEventSchema.parse({
    provider: 'stripe',
    providerEventId: envelope.id,
    eventType: envelope.type,
    occurredAt: new Date(envelope.created * 1000),
    entitlementKeys: [],
    ...mapEvent(envelope),
  });
}
