import { connectionOf } from './seed-directory';
import type { Deliverer } from './seed-deliver';
import {
  daysAfter,
  daysBefore,
  paddleRefund,
  paddleSubscription,
  paddleTransaction,
  paypalCapture,
  paypalSubscription,
  revenueCatEvent,
  type PaddleTransaction,
  type RevenueCatPurchase,
} from './seed-payloads';
import { CURRENCIES, peopleOf, type Person, type SeedCurrency } from './seed-people';
import { priceFor } from './seed-stripe';

const RC_PRICE: Record<SeedCurrency, number> = { USD: 9.99, EUR: 8.99, GBP: 7.99, JPY: 1500 };
const PERIOD_DAYS = 14;

export async function seedPaddle(d: Deliverer, anchor: Date): Promise<void> {
  const conn = connectionOf('acme', 'paddle');
  for (const person of peopleOf('acme', 'paddle')) {
    for (let j = 0; j < 4; j++) {
      const txn: PaddleTransaction = {
        id: `txn_demo_${person.key}_${j}`,
        customer: person.providerCustomerId,
        amount: priceFor(person.currency, person.index + j + 1),
        currency: person.currency,
        at: daysBefore(anchor, 2 + ((person.index * 5 + j * 7) % 27), 11 + (j % 5)),
      };
      await d.deliver(conn, paddleTransaction(txn));
      if ((person.index + j) % 5 === 2) {
        await d.deliver(conn, paddleRefund(txn, new Date(txn.at.getTime() + 4 * 3_600_000)));
      }
    }
    if (person.index < 3) {
      const at = daysBefore(anchor, 20 - person.index, 8);
      const end = daysAfter(anchor, 4 + person.index);
      const sub = paddleSubscription(
        `sub_demo_${person.key}`,
        person.providerCustomerId,
        person.currency,
        end,
        at,
      );
      await d.deliver(conn, sub);
    }
  }
}

type RcPlan = {
  initialDaysAgo: number;
  then: ('RENEWAL' | 'BILLING_ISSUE' | 'CANCELLATION' | 'EXPIRATION')[];
};

const RC_PLANS: RcPlan[] = [
  { initialDaysAgo: 22, then: ['RENEWAL'] },
  { initialDaysAgo: 6, then: [] },
  { initialDaysAgo: 29, then: ['RENEWAL', 'RENEWAL'] },
  { initialDaysAgo: 16, then: ['BILLING_ISSUE'] },
  { initialDaysAgo: 10, then: ['CANCELLATION'] },
  { initialDaysAgo: 20, then: ['EXPIRATION'] },
  { initialDaysAgo: 25, then: ['EXPIRATION'] },
  { initialDaysAgo: 12, then: [] },
];

const RC_FIXTURE = {
  RENEWAL: 'renewal',
  BILLING_ISSUE: 'billing-issue',
  CANCELLATION: 'cancellation-unsubscribe',
  EXPIRATION: 'expiration',
} as const;

function purchase(person: Person, id: string, at: Date, periods: number): RevenueCatPurchase {
  return {
    id,
    user: person.providerCustomerId,
    transaction: `txn_demo_${person.key}`,
    currency: person.currency,
    price: RC_PRICE[person.currency],
    at,
    expiresAt: new Date(at.getTime() + periods * PERIOD_DAYS * 86_400_000),
  };
}

export async function seedRevenueCat(d: Deliverer, anchor: Date): Promise<void> {
  const conn = connectionOf('acme', 'revenuecat');
  for (const person of peopleOf('acme', 'revenuecat')) {
    const plan = RC_PLANS[person.index];
    if (!plan) continue;
    const start = daysBefore(anchor, plan.initialDaysAgo, 9);
    const initial = purchase(person, `rc_evt_demo_${person.key}_0`, start, 1);
    await d.deliver(conn, revenueCatEvent('initial-purchase', initial));
    let periods = 1;
    for (const [n, kind] of plan.then.entries()) {
      const at = new Date(start.getTime() + (n + 1) * PERIOD_DAYS * 86_400_000);
      const renewal = kind === 'RENEWAL';
      if (renewal) periods += 1;
      const when = renewal ? at : new Date(Math.min(at.getTime(), anchor.getTime() - 3_600_000));
      const event = purchase(person, `rc_evt_demo_${person.key}_${n + 1}`, when, 1);
      event.expiresAt = new Date(start.getTime() + periods * PERIOD_DAYS * 86_400_000);
      await d.deliver(conn, revenueCatEvent(RC_FIXTURE[kind], event));
    }
    if (person.key === 'victor.hale') {
      const oneOff = purchase(
        person,
        `rc_evt_demo_${person.key}_one_off`,
        daysBefore(anchor, 5, 15),
        0,
      );
      oneOff.transaction = `txn_demo_${person.key}_one_off`;
      await d.deliver(conn, revenueCatEvent('non-renewing-purchase', oneOff));
    }
  }
}

export async function seedPayPal(d: Deliverer, anchor: Date): Promise<void> {
  const conn = connectionOf('globex', 'paypal');
  for (let n = 0; n < 14; n++) {
    const currency = CURRENCIES[n % CURRENCIES.length] ?? 'USD';
    const at = daysBefore(anchor, 1 + ((n * 5) % 29), 9 + (n % 9));
    await d.deliver(
      conn,
      paypalCapture(
        `5DEMOCAPTURE${String(n).padStart(3, '0')}`,
        priceFor(currency, n),
        currency,
        at,
      ),
    );
  }
  const states = [
    'subscription-activated',
    'subscription-suspended',
    'subscription-cancelled',
  ] as const;
  for (const [i, person] of peopleOf('globex', 'paypal').entries()) {
    const fixture = states[i];
    if (!fixture) continue;
    const at = daysBefore(anchor, 18 - i * 3, 9);
    const id = `I-DEMO${person.key.replace('.', '').toUpperCase()}`;
    await d.deliver(
      conn,
      paypalSubscription(fixture, id, person.providerCustomerId, daysAfter(anchor, 6 + i), at),
    );
  }
}
