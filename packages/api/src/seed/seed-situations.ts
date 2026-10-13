import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { entitlementRecordsTable, subscriptionRecordsTable } from '../db/schema/records';
import { connectionOf } from './seed-directory';
import type { Deliverer } from './seed-deliver';
import { DEMO_ORGS } from './seed-identity';
import { demoId } from './seed-ids';
import {
  daysBefore,
  stripePayment,
  stripeRefund,
  type Obj,
  type StripePayment,
} from './seed-payloads';
import { personByKey } from './seed-people';
import {
  EXPIRED_WITH_ENTITLEMENT,
  GUIDED_DEMO_PERSON,
  OUT_OF_ORDER_PERSON,
  priceFor,
  stripePaymentsOf,
} from './seed-stripe';

const acmeStripe = () => connectionOf('acme', 'stripe');

function extraPayment(key: string, id: string, amount: number, at: Date): StripePayment {
  const person = personByKey(key);
  return { id, customer: person.providerCustomerId, amount, currency: person.currency, at };
}

async function duplicateDelivery(d: Deliverer, anchor: Date): Promise<void> {
  const ava = personByKey('ava.chen');
  const first = stripePaymentsOf(ava, 'acme', anchor)[0];
  if (!first) throw new Error('ava.chen has no payments');
  await d.deliver(acmeStripe(), stripePayment(first));
}

async function outOfOrderPair(d: Deliverer, anchor: Date): Promise<void> {
  const person = personByKey(OUT_OF_ORDER_PERSON);
  const payment = extraPayment(
    person.key,
    'pi_demo_out_of_order',
    priceFor(person.currency, 2),
    daysBefore(anchor, 3, 10),
  );
  const refundAt = new Date(payment.at.getTime() + 30 * 60_000);
  await d.deliver(acmeStripe(), stripePayment(payment));
  await d.deliver(acmeStripe(), stripeRefund(payment, payment.amount, refundAt));
  const late = { ...stripePayment(payment), id: `evt_demo_late_${payment.id}` };
  await d.deliver(acmeStripe(), late);
}

async function brokenEvents(d: Deliverer, anchor: Date): Promise<void> {
  for (const [n, days] of [2, 4, 6].entries()) {
    const person = personByKey('lucas.silva');
    const at = daysBefore(anchor, days, 16);
    const payment = extraPayment(person.key, `pi_demo_broken_${n}`, 0, at);
    const payload = stripePayment(payment);
    const object = (payload['data'] as { object: Obj }).object;
    delete object['amount'];
    delete object['amount_received'];
    await d.deliverBroken(
      acmeStripe(),
      {
        providerEventId: `evt_demo_${payment.id}`,
        eventType: 'payment_intent.succeeded',
        occurredAt: at,
      },
      payload,
    );
  }
}

async function queuedEvents(d: Deliverer, anchor: Date): Promise<void> {
  for (const [n, key] of ['zoe.fischer', 'oliver.grant'].entries()) {
    const person = personByKey(key);
    const payment = extraPayment(
      key,
      `pi_demo_queued_${n}`,
      priceFor(person.currency, 1),
      daysBefore(anchor, 1, 22 + n),
    );
    await d.deliver(acmeStripe(), stripePayment(payment), 'queue');
  }
}

async function guidedDemoPayment(d: Deliverer, anchor: Date): Promise<void> {
  const person = personByKey(GUIDED_DEMO_PERSON);
  const payment = extraPayment(
    person.key,
    'pi_demo_maya_guided',
    priceFor(person.currency, 1),
    daysBefore(anchor, 2, 14),
  );
  await d.deliver(acmeStripe(), stripePayment(payment));
}

async function expiredSubscriptionWithActiveEntitlement(db: Db, anchor: Date): Promise<void> {
  const [subscription] = await db
    .select({ id: subscriptionRecordsTable.id })
    .from(subscriptionRecordsTable)
    .where(
      and(
        eq(subscriptionRecordsTable.connectionId, acmeStripe().id),
        eq(subscriptionRecordsTable.providerSubscriptionId, `sub_demo_${EXPIRED_WITH_ENTITLEMENT}`),
      ),
    );
  if (!subscription) throw new Error('expired demo subscription missing');
  await db
    .insert(entitlementRecordsTable)
    .values({
      id: demoId(`entitlement:${EXPIRED_WITH_ENTITLEMENT}:pro`),
      orgId: DEMO_ORGS.acme.id,
      customerId: demoId(`customer:${EXPIRED_WITH_ENTITLEMENT}`),
      subscriptionId: subscription.id,
      entitlementKey: 'pro',
      state: 'active',
      source: 'scenario',
      grantedAt: daysBefore(anchor, 26, 8),
      lastEventAt: daysBefore(anchor, 26, 8),
    })
    .onConflictDoUpdate({
      target: [
        entitlementRecordsTable.orgId,
        entitlementRecordsTable.customerId,
        entitlementRecordsTable.entitlementKey,
      ],
      set: { state: 'active', source: 'scenario', expiresAt: null },
    });
}

async function dropGuidedDemoEntitlement(db: Db): Promise<void> {
  await db
    .delete(entitlementRecordsTable)
    .where(eq(entitlementRecordsTable.customerId, demoId(`customer:${GUIDED_DEMO_PERSON}`)));
}

export async function seedSituations(db: Db, d: Deliverer, anchor: Date): Promise<void> {
  await duplicateDelivery(d, anchor);
  await outOfOrderPair(d, anchor);
  await brokenEvents(d, anchor);
  await queuedEvents(d, anchor);
  await guidedDemoPayment(d, anchor);
  await dropGuidedDemoEntitlement(db);
  await expiredSubscriptionWithActiveEntitlement(db, anchor);
}
