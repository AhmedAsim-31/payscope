import { z } from 'zod';
import type { NormalizedEvent } from '../normalized-event';
import { NormalizedEventSchema } from '../normalized-event';
import { ProviderError } from '../provider-error';
import { parsePaddleMinorUnits } from './paddle-amount';
import type { PaddleEnvelope } from './paddle-envelope';
import { PaddleEnvelopeSchema } from './paddle-envelope';

const TransactionSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  customer_id: z.string().min(1).nullish(),
  subscription_id: z.string().min(1).nullish(),
  origin: z.string().nullish(),
  currency_code: z.string().min(1),
  details: z.looseObject({ totals: z.looseObject({ grand_total: z.string() }) }).nullish(),
});

const AdjustmentSchema = z.looseObject({
  id: z.string().min(1),
  action: z.string().min(1),
  status: z.string().min(1),
  transaction_id: z.string().min(1),
  subscription_id: z.string().min(1).nullish(),
  customer_id: z.string().min(1).nullish(),
  currency_code: z.string().min(1),
  totals: z.looseObject({ total: z.string() }),
});

const SubscriptionSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  customer_id: z.string().min(1).nullish(),
  currency_code: z.string().min(1).nullish(),
  current_billing_period: z.looseObject({ ends_at: z.string().min(1) }).nullish(),
  items: z
    .array(z.looseObject({ price: z.looseObject({ id: z.string().min(1) }).nullish() }))
    .nullish(),
});

type EventBody = Omit<
  NormalizedEvent,
  'provider' | 'providerEventId' | 'eventType' | 'occurredAt' | 'entitlementKeys'
>;

const SUBSCRIPTION_TYPES: Readonly<Record<string, NormalizedEvent['normalizedType']>> = {
  'subscription.created': 'subscription.created',
  'subscription.activated': 'subscription.created',
  'subscription.updated': 'subscription.updated',
  'subscription.canceled': 'subscription.canceled',
  'subscription.past_due': 'subscription.updated',
  'subscription.paused': 'subscription.updated',
  'subscription.resumed': 'subscription.updated',
};

function parseData<T extends z.ZodType>(schema: T, envelope: PaddleEnvelope): z.output<T> {
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new ProviderError('invalid_input', `Invalid Paddle ${envelope.event_type} data`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function transactionBody(envelope: PaddleEnvelope): EventBody {
  const txn = parseData(TransactionSchema, envelope);
  const amount = txn.details ? parsePaddleMinorUnits(txn.details.totals.grand_total) : null;
  const base = {
    providerCustomerId: txn.customer_id ?? null,
    amountMinor: amount,
    currency: txn.currency_code,
    status: txn.status,
  };
  const subscriptionRef = txn.subscription_id ? { subscriptionId: txn.subscription_id } : null;
  if (envelope.event_type === 'transaction.payment_failed') {
    return {
      ...base,
      normalizedType: 'payment.failed',
      objectType: 'payment',
      objectId: txn.id,
      metadata: subscriptionRef,
    };
  }
  if (txn.subscription_id && txn.origin === 'subscription_recurring') {
    return {
      ...base,
      normalizedType: 'subscription.renewed',
      objectType: 'subscription',
      objectId: txn.subscription_id,
      metadata: { transactionId: txn.id },
    };
  }
  return {
    ...base,
    normalizedType: 'payment.succeeded',
    objectType: 'payment',
    objectId: txn.id,
    metadata: subscriptionRef,
  };
}

function adjustmentBody(envelope: PaddleEnvelope): EventBody | undefined {
  const adj = parseData(AdjustmentSchema, envelope);
  const base = {
    providerCustomerId: adj.customer_id ?? null,
    amountMinor: parsePaddleMinorUnits(adj.totals.total),
    currency: adj.currency_code,
    status: adj.status,
  };
  if (adj.action === 'refund' && adj.status === 'approved') {
    return {
      ...base,
      normalizedType: 'payment.refunded',
      objectType: 'payment',
      objectId: adj.transaction_id,
      metadata: {
        adjustmentId: adj.id,
        ...(adj.subscription_id ? { subscriptionId: adj.subscription_id } : {}),
      },
    };
  }
  if (adj.action === 'chargeback') {
    return {
      ...base,
      normalizedType: 'payment.disputed',
      objectType: 'dispute',
      objectId: adj.id,
      metadata: { transactionId: adj.transaction_id },
    };
  }
  return undefined;
}

function subscriptionBody(
  envelope: PaddleEnvelope,
  type: NormalizedEvent['normalizedType'],
): EventBody {
  const sub = parseData(SubscriptionSchema, envelope);
  return {
    normalizedType: type,
    objectType: 'subscription',
    objectId: sub.id,
    providerCustomerId: sub.customer_id ?? null,
    amountMinor: null,
    currency: sub.currency_code ?? null,
    status: sub.status,
    metadata: {
      ...(sub.current_billing_period
        ? { currentPeriodEnd: sub.current_billing_period.ends_at }
        : {}),
      ...(sub.items?.[0]?.price ? { planId: sub.items[0].price.id } : {}),
    },
  };
}

function unsupportedBody(envelope: PaddleEnvelope): EventBody {
  const id = envelope.data['id'];
  return {
    normalizedType: 'unsupported',
    objectType: 'other',
    objectId: typeof id === 'string' && id ? id : envelope.event_id,
    providerCustomerId: null,
    amountMinor: null,
    currency: null,
    status: null,
    metadata: null,
  };
}

function buildBody(envelope: PaddleEnvelope): EventBody {
  const { event_type: type } = envelope;
  if (
    type === 'transaction.completed' ||
    type === 'transaction.paid' ||
    type === 'transaction.payment_failed'
  ) {
    return transactionBody(envelope);
  }
  if (type === 'adjustment.created' || type === 'adjustment.updated') {
    return adjustmentBody(envelope) ?? unsupportedBody(envelope);
  }
  const subscriptionType = SUBSCRIPTION_TYPES[type];
  return subscriptionType
    ? subscriptionBody(envelope, subscriptionType)
    : unsupportedBody(envelope);
}

export function normalizePaddleEvent(payload: unknown): NormalizedEvent {
  const parsed = PaddleEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProviderError('invalid_input', 'Invalid Paddle event envelope', {
      cause: parsed.error,
    });
  }
  const envelope = parsed.data;
  const body = buildBody(envelope);
  const event = {
    provider: 'paddle',
    providerEventId: envelope.event_id,
    eventType: envelope.event_type,
    occurredAt: new Date(envelope.occurred_at),
    entitlementKeys: [],
    ...body,
    currency: body.currency?.toUpperCase() ?? null,
  };
  const checked = NormalizedEventSchema.safeParse(event);
  if (!checked.success) {
    throw new ProviderError('invalid_input', 'Paddle event failed normalization', {
      cause: checked.error,
    });
  }
  return checked.data;
}
