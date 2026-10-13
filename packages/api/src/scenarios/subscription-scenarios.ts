import { entitlementRecordsTable } from '../db/schema/records';
import { LAB_PRICE_PRO, LAB_PRICE_UNMAPPED } from './lab-setup';
import type { Lab, Scenario } from './lab';
import {
  checkProcessed,
  findEntitlement,
  findPayment,
  findSubscription,
  labPayment,
} from './record-lookup';
import { paymentSucceeded, subscriptionEvent, type LabSubscription } from './stripe-payloads';

const MINUTE = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

function labSubscription(lab: Lab, customer: string, price: string): LabSubscription {
  return {
    id: `sub_lab_${lab.tag}`,
    customer,
    price,
    status: 'active',
    periodEnd: inDays(30),
  };
}

export const subscriptionLifecycle: Scenario = async (lab) => {
  const customer = await lab.customer('subscriber');
  const sub = labSubscription(lab, customer.providerCustomerId, LAB_PRICE_PRO);
  await checkProcessed(
    lab,
    await lab.deliver(subscriptionEvent('created', sub, ago(3))),
    'Created',
  );
  const granted = await findEntitlement(lab, customer.id);
  lab.check('Entitlement granted while active', granted?.state === 'active', granted?.state);
  const pastDue = { ...sub, status: 'past_due' };
  await checkProcessed(
    lab,
    await lab.deliver(subscriptionEvent('updated', pastDue, ago(2))),
    'Past due',
  );
  const ended = { ...sub, status: 'canceled', periodEnd: ago(1) };
  await checkProcessed(
    lab,
    await lab.deliver(subscriptionEvent('deleted', ended, ago(1))),
    'Canceled',
  );
  const record = await findSubscription(lab, sub.id);
  lab.check('Subscription ends expired', record?.status === 'expired', record?.status);
  const entitlement = await findEntitlement(lab, customer.id);
  lab.check(
    'Entitlement no longer active',
    entitlement !== undefined && entitlement.state !== 'active',
    entitlement?.state,
  );
};

export const paymentWithInactiveEntitlement: Scenario = async (lab) => {
  const customer = await lab.customer('payer');
  const payment = labPayment(lab, customer, 1, 5);
  const sub = labSubscription(lab, customer.providerCustomerId, LAB_PRICE_UNMAPPED);
  await checkProcessed(lab, await lab.deliver(paymentSucceeded(payment)), 'Payment');
  await checkProcessed(
    lab,
    await lab.deliver(subscriptionEvent('created', sub, ago(4))),
    'Subscription',
  );
  await findPayment(lab, payment.id);
  await findSubscription(lab, sub.id);
  lab.check('No entitlement was granted', (await findEntitlement(lab, customer.id)) === undefined);
  const run = await lab.reconcile('local');
  lab.check('Reconciliation run completed', run?.status === 'completed', run?.status);
  const findings = await lab.findings(run?.id ?? '', [customer.id]);
  lab.check(
    'entitlement_missing_or_stale finding raised',
    findings.some((f) => f.type === 'entitlement_missing_or_stale'),
    findings.map((f) => f.type).join(', '),
  );
};

export const expiredWithActiveEntitlement: Scenario = async (lab) => {
  const customer = await lab.customer('lapsed');
  const sub = labSubscription(lab, customer.providerCustomerId, LAB_PRICE_UNMAPPED);
  await checkProcessed(
    lab,
    await lab.deliver(subscriptionEvent('created', sub, ago(3))),
    'Created',
  );
  const ended = { ...sub, status: 'canceled', periodEnd: ago(1) };
  await checkProcessed(
    lab,
    await lab.deliver(subscriptionEvent('deleted', ended, ago(1))),
    'Ended',
  );
  const record = await findSubscription(lab, sub.id);
  if (!record) throw new Error('subscription record missing');
  const [entitlement] = await lab.env.db
    .insert(entitlementRecordsTable)
    .values({
      orgId: lab.env.orgId,
      customerId: customer.id,
      subscriptionId: record.id,
      entitlementKey: 'pro',
      state: 'active',
      source: 'scenario',
      grantedAt: ago(3),
      lastEventAt: ago(3),
    })
    .returning({ id: entitlementRecordsTable.id });
  if (entitlement) lab.track('entitlementIds', entitlement.id);
  lab.note('Entitlement left active on purpose to simulate a missed revocation.');
  const run = await lab.reconcile('local');
  lab.check('Reconciliation run completed', run?.status === 'completed', run?.status);
  const findings = await lab.findings(run?.id ?? '', [record.id]);
  lab.check(
    'expired_externally_active_locally finding raised',
    findings.some((f) => f.type === 'expired_externally_active_locally'),
    findings.map((f) => f.type).join(', '),
  );
};
