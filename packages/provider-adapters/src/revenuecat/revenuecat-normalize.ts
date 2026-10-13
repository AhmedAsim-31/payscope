import type { NormalizedEvent } from '../normalized-event';
import { NormalizedEventSchema } from '../normalized-event';
import { ProviderError } from '../provider-error';
import { revenueCatPriceToMinor } from './revenuecat-amount';
import { RevenueCatEnvelopeSchema } from './revenuecat-envelope';

type Mapping = {
  normalizedType: NormalizedEvent['normalizedType'];
  objectType: NormalizedEvent['objectType'];
  entitlements: boolean;
};

const MAPPINGS: Readonly<Record<string, Mapping>> = {
  INITIAL_PURCHASE: {
    normalizedType: 'subscription.created',
    objectType: 'subscription',
    entitlements: true,
  },
  RENEWAL: {
    normalizedType: 'subscription.renewed',
    objectType: 'subscription',
    entitlements: true,
  },
  CANCELLATION: {
    normalizedType: 'subscription.canceled',
    objectType: 'subscription',
    entitlements: false,
  },
  UNCANCELLATION: {
    normalizedType: 'subscription.updated',
    objectType: 'subscription',
    entitlements: false,
  },
  EXPIRATION: {
    normalizedType: 'subscription.expired',
    objectType: 'subscription',
    entitlements: true,
  },
  BILLING_ISSUE: {
    normalizedType: 'payment.failed',
    objectType: 'subscription',
    entitlements: false,
  },
  PRODUCT_CHANGE: {
    normalizedType: 'subscription.updated',
    objectType: 'subscription',
    entitlements: false,
  },
  NON_RENEWING_PURCHASE: {
    normalizedType: 'payment.succeeded',
    objectType: 'payment',
    entitlements: false,
  },
};

const REFUND: Mapping = {
  normalizedType: 'payment.refunded',
  objectType: 'payment',
  entitlements: false,
};

const UNSUPPORTED: Mapping = {
  normalizedType: 'unsupported',
  objectType: 'other',
  entitlements: false,
};

function mappingFor(type: string, cancelReason: string | null | undefined): Mapping {
  if (type === 'CANCELLATION' && cancelReason === 'CUSTOMER_SUPPORT') return REFUND;
  return MAPPINGS[type] ?? UNSUPPORTED;
}

function currencyOf(value: string | null | undefined): string | null {
  const upper = value?.toUpperCase();
  return upper && /^[A-Z]{3}$/.test(upper) ? upper : null;
}

export function normalizeRevenueCatEvent(payload: unknown): NormalizedEvent {
  const parsed = RevenueCatEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProviderError('invalid_input', 'Invalid RevenueCat event envelope', {
      cause: parsed.error,
    });
  }
  const { event } = parsed.data;
  if (event.environment !== 'SANDBOX') {
    throw new ProviderError('invalid_input', 'RevenueCat adapter is sandbox-only');
  }
  const mapping = mappingFor(event.type, event.cancel_reason);
  const currency = currencyOf(event.currency);
  const price = event.price_in_purchased_currency;
  let amountMinor: bigint | null = null;
  const metadata: Record<string, unknown> = {};
  if (price != null && currency) {
    amountMinor = revenueCatPriceToMinor(price, currency);
    if (amountMinor === null) metadata['priceRaw'] = String(price);
    else if (mapping === REFUND && amountMinor < 0n) amountMinor = -amountMinor;
  }
  for (const key of ['store', 'product_id', 'period_type', 'cancel_reason', 'expiration_reason']) {
    const value = event[key];
    if (typeof value === 'string') metadata[key] = value;
  }
  const checked = NormalizedEventSchema.safeParse({
    provider: 'revenuecat',
    providerEventId: event.id,
    eventType: event.type,
    normalizedType: mapping.normalizedType,
    occurredAt: new Date(event.event_timestamp_ms),
    objectType: mapping.objectType,
    objectId: event.original_transaction_id ?? event.transaction_id ?? event.id,
    providerCustomerId: event.app_user_id,
    amountMinor,
    currency,
    status: null,
    entitlementKeys: mapping.entitlements ? (event.entitlement_ids ?? []) : [],
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  });
  if (!checked.success) {
    throw new ProviderError('invalid_input', 'RevenueCat event failed normalization', {
      cause: checked.error,
    });
  }
  return checked.data;
}
