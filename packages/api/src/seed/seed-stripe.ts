import { connectionOf } from './seed-directory';
import type { Deliverer } from './seed-deliver';
import type { DemoOrgKey } from './seed-identity';
import { peopleOf, type Person, type SeedCurrency } from './seed-people';
import {
  daysAfter,
  daysBefore,
  stripePayment,
  stripeRefund,
  stripeSubscription,
  type StripePayment,
  type StripeSubscription,
} from './seed-payloads';

const PRICE_MINOR: Record<SeedCurrency, number[]> = {
  USD: [999, 1999, 4999, 14900],
  EUR: [899, 1799, 4599, 13900],
  GBP: [799, 1599, 3999, 11900],
  JPY: [1500, 3000, 6000, 18000],
};

export const priceFor = (currency: SeedCurrency, n: number): number =>
  PRICE_MINOR[currency][n % 4] ?? 999;

type SubState = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired' | 'ending';

const SUBSCRIPTION_STATES: Record<DemoOrgKey, SubState[]> = {
  acme: [
    'active',
    'active',
    'trialing',
    'past_due',
    'expired',
    'canceled',
    'active',
    'ending',
    'expired',
    'active',
  ],
  globex: ['active', 'active', 'trialing', 'past_due', 'canceled', 'expired', 'active'],
};

export const EXPIRED_WITH_ENTITLEMENT = 'noah.kim';
export const GUIDED_DEMO_PERSON = 'maya.patel';
export const OUT_OF_ORDER_PERSON = 'emma.larsen';

export function stripePaymentsOf(person: Person, org: DemoOrgKey, anchor: Date): StripePayment[] {
  const orgShift = org === 'acme' ? 0 : 3;
  const count = org === 'acme' ? 3 + (person.index % 3) : 4;
  return Array.from({ length: count }, (_, j) => ({
    id: `pi_demo_${person.key}_${j}`,
    customer: person.providerCustomerId,
    amount: priceFor(person.currency, person.index + j),
    currency: person.currency,
    at: daysBefore(anchor, 1 + ((person.index * 7 + j * 6 + orgShift) % 29), 9 + (j % 8)),
  }));
}

export async function seedStripePayments(
  d: Deliverer,
  org: DemoOrgKey,
  anchor: Date,
): Promise<StripePayment[]> {
  const conn = connectionOf(org, 'stripe');
  const delivered: StripePayment[] = [];
  for (const person of peopleOf(org, 'stripe')) {
    for (const [j, payment] of stripePaymentsOf(person, org, anchor).entries()) {
      const failed = (person.index + j) % 9 === 4;
      await d.deliver(conn, stripePayment(payment, failed));
      delivered.push(payment);
      if (!failed && (person.index + j) % 7 === 3) {
        const refundAt = new Date(payment.at.getTime() + 3 * 3_600_000);
        await d.deliver(conn, stripeRefund(payment, Math.floor(payment.amount / 2), refundAt));
      }
    }
  }
  return delivered;
}

function subscriptionOf(person: Person, state: SubState, anchor: Date): StripeSubscription {
  const live = state === 'active' || state === 'trialing' || state === 'ending';
  return {
    id: `sub_demo_${person.key}`,
    customer: person.providerCustomerId,
    currency: person.currency,
    price: 'price_demo_pro',
    status: state === 'trialing' ? 'trialing' : 'active',
    periodEnd: live ? daysAfter(anchor, 5 + person.index) : daysBefore(anchor, 2, 0),
    cancelAtPeriodEnd: state === 'ending',
  };
}

export async function seedStripeSubscriptions(
  d: Deliverer,
  org: DemoOrgKey,
  anchor: Date,
): Promise<void> {
  const conn = connectionOf(org, 'stripe');
  const people = peopleOf(org, 'stripe');
  for (const [i, state] of SUBSCRIPTION_STATES[org].entries()) {
    const person = people[i];
    if (!person) continue;
    const sub = subscriptionOf(person, state, anchor);
    const startedDays = 28 - i * 2;
    await d.deliver(conn, stripeSubscription('created', sub, daysBefore(anchor, startedDays, 8)));
    const later = daysBefore(anchor, startedDays - 6, 8);
    if (state === 'past_due') {
      await d.deliver(conn, stripeSubscription('updated', { ...sub, status: 'past_due' }, later));
    } else if (state === 'canceled') {
      await d.deliver(conn, stripeSubscription('updated', { ...sub, status: 'canceled' }, later));
    } else if (state === 'expired') {
      await d.deliver(conn, stripeSubscription('deleted', { ...sub, status: 'canceled' }, later));
    }
  }
}
