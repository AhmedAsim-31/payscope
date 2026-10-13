import { eq, sql } from 'drizzle-orm';
import { backgroundJobsTable } from '../db/schema/jobs';
import type { Lab, Scenario } from './lab';
import { attemptsOf, checkProcessed, findPayment, labPayment } from './record-lookup';
import { paymentEventId, paymentSucceeded, type Obj } from './stripe-payloads';

async function deliverPayment(lab: Lab, key = 'buyer') {
  const customer = await lab.customer(key);
  const payment = labPayment(lab, customer, 1);
  const ingested = await lab.deliver(paymentSucceeded(payment));
  await checkProcessed(lab, ingested);
  const record = await findPayment(lab, payment.id);
  if (!record) throw new Error('payment record missing');
  return { payment, record };
}

export async function makeRetryableNow(lab: Lab, jobId: string): Promise<void> {
  await lab.env.db
    .update(backgroundJobsTable)
    .set({ availableAt: sql`now()` })
    .where(eq(backgroundJobsTable.id, jobId));
}

export const providerApiFailure: Scenario = async (lab) => {
  const { payment, record } = await deliverPayment(lab);
  lab.overrides.set(payment.id, { down: true });
  const run = await lab.reconcile('provider');
  lab.check('Run finished without failing', run?.status === 'partial', run?.status);
  const findings = await lab.findings(run?.id ?? '', [record.id]);
  const found = findings.find((f) => f.type === 'provider_unavailable');
  lab.check('provider_unavailable finding raised', found !== undefined);
  lab.check('Finding is low severity', found?.severity === 'low', found?.severity);
};

export const processingFailure: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1);
  const payload = paymentSucceeded(payment);
  const object = (payload['data'] as { object: Obj }).object;
  delete object['amount'];
  delete object['amount_received'];
  const ingested = await lab.ingestUnprocessable(paymentEventId(payment), payload, payment.at);
  await lab.drain([ingested.jobId]);
  const event = await lab.event(ingested.eventId);
  const job = await lab.job(ingested.jobId);
  lab.check('Event needs attention', event.status === 'needs_attention', event.status);
  lab.check('Job is dead', job.status === 'dead', job.status);
  const attempts = await attemptsOf(lab, ingested.eventId);
  lab.check(
    'Failed attempt recorded',
    attempts.some((a) => a.outcome === 'failed'),
  );
};

export const retryExhaustion: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payload = paymentSucceeded(labPayment(lab, customer, 1));
  const ingested = await lab.ingest(payload);
  await lab.env.db
    .update(backgroundJobsTable)
    .set({ maxAttempts: 3 })
    .where(eq(backgroundJobsTable.id, ingested.jobId));
  lab.failNext(String(payload['id']), Number.MAX_SAFE_INTEGER);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await lab.drain([ingested.jobId]);
    if (attempt < 3) await makeRetryableNow(lab, ingested.jobId);
  }
  const job = await lab.job(ingested.jobId);
  const event = await lab.event(ingested.eventId);
  const attempts = await attemptsOf(lab, ingested.eventId);
  lab.check(
    'Job is dead after 3 attempts',
    job.status === 'dead' && job.attemptCount === 3,
    `${job.status} after ${job.attemptCount}`,
  );
  lab.check('Event needs attention', event.status === 'needs_attention', event.status);
  lab.check(
    'Three failed attempts recorded',
    attempts.filter((a) => a.outcome === 'failed').length === 3,
  );
};

export const reconciliationMismatch: Scenario = async (lab) => {
  const { payment, record } = await deliverPayment(lab);
  lab.overrides.set(payment.id, { status: 'canceled' });
  const run = await lab.reconcile('provider');
  lab.check('Run completed', run?.status === 'completed', run?.status);
  const findings = await lab.findings(run?.id ?? '', [record.id]);
  lab.check(
    'status_mismatch finding raised',
    findings.some((f) => f.type === 'status_mismatch'),
  );
};

export const recoveryAfterFailure: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1);
  const payload = paymentSucceeded(payment);
  const ingested = await lab.ingest(payload);
  lab.failNext(String(payload['id']), 1);
  await lab.drain([ingested.jobId]);
  const failed = await lab.job(ingested.jobId);
  lab.check(
    'First attempt failed and was scheduled to retry',
    failed.status === 'queued' && failed.attemptCount === 1,
    `${failed.status} after ${failed.attemptCount}`,
  );
  lab.check(
    'Payment not recorded during the outage',
    (await findPayment(lab, payment.id)) === undefined,
  );
  await makeRetryableNow(lab, ingested.jobId);
  await lab.drain([ingested.jobId]);
  await checkProcessed(lab, ingested, 'Retried event');
  const record = await findPayment(lab, payment.id);
  lab.check('Payment recorded after recovery', record?.status === 'succeeded', record?.status);
};
