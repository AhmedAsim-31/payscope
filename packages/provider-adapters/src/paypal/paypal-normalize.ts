import { z } from 'zod';
import type { NormalizedEvent } from '../normalized-event';
import { NormalizedEventSchema } from '../normalized-event';
import { ProviderError } from '../provider-error';
import { parsePayPalAmount } from './paypal-amount';
import { PayPalEnvelopeSchema } from './paypal-envelope';

type Mapping = {
  normalizedType: NormalizedEvent['normalizedType'];
  objectType: NormalizedEvent['objectType'];
};

const PAYMENT: Mapping = { normalizedType: 'payment.succeeded', objectType: 'payment' };
const SUBSCRIPTION = (normalizedType: Mapping['normalizedType']): Mapping => ({
  normalizedType,
  objectType: 'subscription',
});

const MAPPINGS: Readonly<Record<string, Mapping>> = {
  'PAYMENT.CAPTURE.COMPLETED': PAYMENT,
  'PAYMENT.CAPTURE.DENIED': { ...PAYMENT, normalizedType: 'payment.failed' },
  'PAYMENT.CAPTURE.REFUNDED': { ...PAYMENT, normalizedType: 'payment.refunded' },
  'PAYMENT.CAPTURE.REVERSED': { ...PAYMENT, normalizedType: 'payment.disputed' },
  'CUSTOMER.DISPUTE.CREATED': { normalizedType: 'payment.disputed', objectType: 'dispute' },
  'CUSTOMER.DISPUTE.RESOLVED': { normalizedType: 'dispute.closed', objectType: 'dispute' },
  'BILLING.SUBSCRIPTION.CREATED': SUBSCRIPTION('subscription.created'),
  'BILLING.SUBSCRIPTION.ACTIVATED': SUBSCRIPTION('subscription.created'),
  'BILLING.SUBSCRIPTION.UPDATED': SUBSCRIPTION('subscription.updated'),
  'BILLING.SUBSCRIPTION.SUSPENDED': SUBSCRIPTION('subscription.updated'),
  'BILLING.SUBSCRIPTION.CANCELLED': SUBSCRIPTION('subscription.canceled'),
  'BILLING.SUBSCRIPTION.EXPIRED': SUBSCRIPTION('subscription.expired'),
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': SUBSCRIPTION('payment.failed'),
  'PAYMENT.SALE.COMPLETED': SUBSCRIPTION('subscription.renewed'),
};

const UNSUPPORTED: Mapping = { normalizedType: 'unsupported', objectType: 'other' };

const MoneySchema = z.object({ currency_code: z.string(), value: z.string() });
const SaleAmountSchema = z.object({ currency: z.string(), total: z.string() });
const ResourceSchema = z.looseObject({
  id: z.string().min(1).nullish(),
  dispute_id: z.string().min(1).nullish(),
  status: z.string().nullish(),
  state: z.string().nullish(),
  plan_id: z.string().nullish(),
  billing_agreement_id: z.string().nullish(),
  amount: z.unknown().optional(),
  dispute_amount: MoneySchema.nullish(),
  subscriber: z.looseObject({ payer_id: z.string().min(1).nullish() }).nullish(),
  billing_info: z
    .looseObject({
      next_billing_time: z.string().nullish(),
      last_failed_payment: z.looseObject({ amount: MoneySchema.nullish() }).nullish(),
    })
    .nullish(),
  supplementary_data: z
    .looseObject({ related_ids: z.looseObject({ order_id: z.string().nullish() }).nullish() })
    .nullish(),
  links: z.array(z.looseObject({ rel: z.string(), href: z.string() })).nullish(),
});

type Resource = z.infer<typeof ResourceSchema>;
type Money = { currency: string; amountMinor: bigint };

function moneyOf(resource: Resource): Money | null {
  const candidates = [
    MoneySchema.safeParse(resource.amount),
    MoneySchema.safeParse(resource.dispute_amount),
    MoneySchema.safeParse(resource.billing_info?.last_failed_payment?.amount),
  ];
  const found = candidates.find((c) => c.success);
  if (found?.success) {
    const currency = found.data.currency_code.toUpperCase();
    return { currency, amountMinor: parsePayPalAmount(found.data.value, currency) };
  }
  const sale = SaleAmountSchema.safeParse(resource.amount);
  if (!sale.success) return null;
  const currency = sale.data.currency.toUpperCase();
  return { currency, amountMinor: parsePayPalAmount(sale.data.total, currency) };
}

function captureIdFromLinks(resource: Resource): string | null {
  const href = resource.links?.find((l) => l.rel === 'up')?.href;
  const match = href ? /\/payments\/captures\/([^/?#]+)/.exec(href) : null;
  return match?.[1] ?? null;
}

export function normalizePayPalEvent(payload: unknown): NormalizedEvent {
  const parsed = PayPalEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProviderError('invalid_input', 'Invalid PayPal event envelope', {
      cause: parsed.error,
    });
  }
  const envelope = parsed.data;
  const parsedResource = ResourceSchema.safeParse(envelope.resource);
  if (!parsedResource.success) {
    throw new ProviderError('invalid_input', 'Invalid PayPal event resource', {
      cause: parsedResource.error,
    });
  }
  const resource = parsedResource.data;
  let mapping = MAPPINGS[envelope.event_type] ?? UNSUPPORTED;
  if (envelope.event_type === 'PAYMENT.SALE.COMPLETED' && !resource.billing_agreement_id) {
    mapping = UNSUPPORTED;
  }
  const metadata: Record<string, unknown> = {};
  let objectId = resource.id ?? envelope.id;
  if (mapping.objectType === 'dispute') {
    objectId = resource.dispute_id ?? objectId;
  } else if (envelope.event_type === 'PAYMENT.SALE.COMPLETED' && resource.billing_agreement_id) {
    metadata['saleId'] = resource.id;
    objectId = resource.billing_agreement_id;
  } else if (
    envelope.event_type === 'PAYMENT.CAPTURE.REFUNDED' ||
    envelope.event_type === 'PAYMENT.CAPTURE.REVERSED'
  ) {
    metadata['refundId'] = resource.id;
    objectId = captureIdFromLinks(resource) ?? objectId;
  }
  if (mapping.objectType === 'payment' && resource.billing_agreement_id) {
    metadata['subscriptionId'] = resource.billing_agreement_id;
  }
  const orderId = resource.supplementary_data?.related_ids?.order_id;
  if (orderId) metadata['orderId'] = orderId;
  if (resource.plan_id) metadata['planId'] = resource.plan_id;
  const nextBilling = resource.billing_info?.next_billing_time;
  if (nextBilling) metadata['nextBillingTime'] = nextBilling;
  const money = mapping === UNSUPPORTED ? null : moneyOf(resource);
  const checked = NormalizedEventSchema.safeParse({
    provider: 'paypal',
    providerEventId: envelope.id,
    eventType: envelope.event_type,
    normalizedType: mapping.normalizedType,
    occurredAt: new Date(envelope.create_time),
    objectType: mapping.objectType,
    objectId,
    providerCustomerId: resource.subscriber?.payer_id ?? null,
    amountMinor: money?.amountMinor ?? null,
    currency: money?.currency ?? null,
    status: resource.status ?? resource.state ?? null,
    entitlementKeys: [],
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  });
  if (!checked.success) {
    throw new ProviderError('invalid_input', 'PayPal event failed normalization', {
      cause: checked.error,
    });
  }
  return checked.data;
}
