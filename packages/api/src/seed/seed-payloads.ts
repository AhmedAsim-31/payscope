import { readFileSync } from 'node:fs';
import { loadRevenueCatFixture } from '@payscope/provider-adapters/revenuecat/revenuecat-fixtures';
import { loadStripeFixture } from '@payscope/provider-adapters/stripe/stripe-fixtures';
import { loadPayPalFixture } from '@payscope/provider-adapters/paypal/paypal-fixtures';
import { formatMinor } from '@payscope/shared/money';

export type Obj = Record<string, unknown>;

const DAY_MS = 86_400_000;
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

export function anchorOf(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

export function daysBefore(anchor: Date, days: number, hour = 10, minute = 0): Date {
  return new Date(anchor.getTime() - days * DAY_MS + hour * 3_600_000 + minute * 60_000);
}

export function daysAfter(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() + days * DAY_MS);
}

function loadPaddleFixture(name: string): Obj {
  const url = new URL(
    `../../../provider-adapters/src/paddle/fixtures/${name}.json`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Obj;
}

function stripeEvent(fixture: string, id: string, at: Date, patch: (object: Obj) => void): Obj {
  const payload: Obj = { ...loadStripeFixture(fixture), id, created: seconds(at) };
  patch((payload['data'] as { object: Obj }).object);
  return payload;
}

export type StripePayment = {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  at: Date;
};

export function stripePayment(p: StripePayment, failed = false): Obj {
  const fixture = failed ? 'payment-intent-payment-failed' : 'payment-intent-succeeded';
  return stripeEvent(fixture, `evt_demo_${p.id}`, p.at, (o) => {
    o['id'] = p.id;
    o['customer'] = p.customer;
    o['amount'] = p.amount;
    o['currency'] = p.currency.toLowerCase();
    o['created'] = seconds(p.at);
    if (!failed) o['amount_received'] = p.amount;
  });
}

export function stripeRefund(p: StripePayment, refunded: number, at: Date): Obj {
  return stripeEvent('charge-refunded', `evt_demo_re_${p.id}`, at, (o) => {
    o['id'] = `ch_demo_${p.id}`;
    o['payment_intent'] = p.id;
    o['customer'] = p.customer;
    o['amount'] = p.amount;
    o['amount_refunded'] = refunded;
    o['currency'] = p.currency.toLowerCase();
  });
}

export type StripeSubscription = {
  id: string;
  customer: string;
  currency: string;
  price: string;
  status: string;
  periodEnd: Date;
  cancelAtPeriodEnd?: boolean;
};

export function stripeSubscription(
  kind: 'created' | 'updated' | 'deleted',
  s: StripeSubscription,
  at: Date,
): Obj {
  return stripeEvent(
    `customer-subscription-${kind}`,
    `evt_demo_${kind}_${s.id}_${s.status}`,
    at,
    (o) => {
      o['id'] = s.id;
      o['customer'] = s.customer;
      o['status'] = s.status;
      o['currency'] = s.currency.toLowerCase();
      o['cancel_at_period_end'] = s.cancelAtPeriodEnd ?? false;
      const item = (o['items'] as { data: Obj[] }).data[0];
      if (item) {
        item['current_period_end'] = seconds(s.periodEnd);
        (item['price'] as Obj)['id'] = s.price;
      }
    },
  );
}

export type RevenueCatPurchase = {
  id: string;
  user: string;
  transaction: string;
  currency: string;
  price: number;
  at: Date;
  expiresAt: Date;
  entitlements?: string[];
};

export function revenueCatEvent(fixture: string, p: RevenueCatPurchase): Obj {
  const payload = loadRevenueCatFixture(fixture) as { event: Obj };
  return {
    ...payload,
    event: {
      ...payload.event,
      id: p.id,
      app_user_id: p.user,
      original_app_user_id: p.user,
      aliases: [p.user],
      product_id: 'pro_monthly',
      entitlement_ids: p.entitlements ?? ['pro'],
      purchased_at_ms: p.at.getTime(),
      expiration_at_ms: p.expiresAt.getTime(),
      currency: p.currency,
      price: p.price,
      price_in_purchased_currency: p.price,
      transaction_id: p.transaction,
      original_transaction_id: p.transaction,
      event_timestamp_ms: p.at.getTime(),
    },
  };
}

export type PaddleTransaction = {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  at: Date;
};

const isoOf = (at: Date) => at.toISOString().replace('.000Z', '.000000Z');

export function paddleTransaction(p: PaddleTransaction): Obj {
  const payload = loadPaddleFixture('transaction-completed');
  const data = payload['data'] as Obj;
  payload['event_id'] = `evt_demo_${p.id}`;
  payload['occurred_at'] = isoOf(p.at);
  data['id'] = p.id;
  data['customer_id'] = p.customer;
  data['currency_code'] = p.currency;
  const totals = (data['details'] as { totals: Obj }).totals;
  for (const key of ['subtotal', 'total', 'grand_total']) totals[key] = String(p.amount);
  totals['currency_code'] = p.currency;
  return payload;
}

export function paddleRefund(p: PaddleTransaction, at: Date): Obj {
  const payload = loadPaddleFixture('adjustment-created-refund-approved');
  const data = payload['data'] as Obj;
  payload['event_id'] = `evt_demo_re_${p.id}`;
  payload['occurred_at'] = isoOf(at);
  data['id'] = `adj_demo_${p.id}`;
  data['transaction_id'] = p.id;
  data['customer_id'] = p.customer;
  data['currency_code'] = p.currency;
  const totals = data['totals'] as Obj;
  for (const key of ['subtotal', 'total', 'earnings']) totals[key] = String(p.amount);
  totals['currency_code'] = p.currency;
  return payload;
}

export function paddleSubscription(
  id: string,
  customer: string,
  currency: string,
  periodEnd: Date,
  at: Date,
): Obj {
  const payload = loadPaddleFixture('subscription-created');
  const data = payload['data'] as Obj;
  payload['event_id'] = `evt_demo_${id}`;
  payload['occurred_at'] = isoOf(at);
  data['id'] = id;
  data['customer_id'] = customer;
  data['currency_code'] = currency;
  (data['current_billing_period'] as Obj)['ends_at'] = isoOf(periodEnd);
  return payload;
}

export function paypalCapture(id: string, amount: number, currency: string, at: Date): Obj {
  const payload = loadPayPalFixture('capture-completed');
  const resource = payload['resource'] as Obj;
  payload['id'] = `WH-DEMO-${id}`;
  payload['create_time'] = at.toISOString();
  resource['id'] = id;
  resource['amount'] = { currency_code: currency, value: formatMinor(BigInt(amount), currency) };
  return payload;
}

export function paypalSubscription(
  fixture: 'subscription-activated' | 'subscription-suspended' | 'subscription-cancelled',
  id: string,
  payer: string,
  nextBilling: Date,
  at: Date,
): Obj {
  const payload = loadPayPalFixture(fixture);
  const resource = payload['resource'] as Obj;
  payload['id'] = `WH-DEMO-${fixture}-${id}`;
  payload['create_time'] = at.toISOString();
  resource['id'] = id;
  (resource['subscriber'] as Obj)['payer_id'] = payer;
  (resource['billing_info'] as Obj)['next_billing_time'] = nextBilling.toISOString();
  return payload;
}
