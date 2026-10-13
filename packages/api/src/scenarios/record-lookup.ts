import { and, eq } from 'drizzle-orm';
import {
  entitlementRecordsTable,
  paymentRecordsTable,
  subscriptionRecordsTable,
} from '../db/schema/records';
import { eventProcessingAttemptsTable } from '../db/schema/events';
import type { Ingested, Lab } from './lab';
import type { LabCustomer } from './lab-setup';
import type { LabPayment } from './stripe-payloads';

export const LAB_AMOUNT = 4900;

export function labPayment(lab: Lab, customer: LabCustomer, n: number, ageMinutes = n): LabPayment {
  return {
    id: `pi_lab_${lab.tag}_${n}`,
    customer: customer.providerCustomerId,
    amount: LAB_AMOUNT,
    at: new Date(Date.now() - ageMinutes * 60_000),
  };
}

export async function findPayment(lab: Lab, providerPaymentId: string) {
  const [row] = await lab.env.db
    .select()
    .from(paymentRecordsTable)
    .where(
      and(
        eq(paymentRecordsTable.connectionId, lab.connection.id),
        eq(paymentRecordsTable.providerPaymentId, providerPaymentId),
      ),
    );
  if (row) lab.track('paymentIds', row.id);
  return row;
}

export async function findSubscription(lab: Lab, providerSubscriptionId: string) {
  const [row] = await lab.env.db
    .select()
    .from(subscriptionRecordsTable)
    .where(
      and(
        eq(subscriptionRecordsTable.connectionId, lab.connection.id),
        eq(subscriptionRecordsTable.providerSubscriptionId, providerSubscriptionId),
      ),
    );
  if (row) lab.track('subscriptionIds', row.id);
  return row;
}

export async function findEntitlement(lab: Lab, customerId: string) {
  const [row] = await lab.env.db
    .select()
    .from(entitlementRecordsTable)
    .where(
      and(
        eq(entitlementRecordsTable.orgId, lab.env.orgId),
        eq(entitlementRecordsTable.customerId, customerId),
      ),
    );
  if (row) lab.track('entitlementIds', row.id);
  return row;
}

export async function attemptsOf(lab: Lab, eventId: string) {
  return lab.env.db
    .select({ outcome: eventProcessingAttemptsTable.outcome })
    .from(eventProcessingAttemptsTable)
    .where(eq(eventProcessingAttemptsTable.eventId, eventId));
}

export async function checkProcessed(lab: Lab, ingested: Ingested, label = 'Event'): Promise<void> {
  const event = await lab.event(ingested.eventId);
  const job = await lab.job(ingested.jobId);
  lab.check(`${label} processed`, event.status === 'processed', `event ${event.status}`);
  lab.check(`${label} job succeeded`, job.status === 'succeeded', `job ${job.status}`);
}
