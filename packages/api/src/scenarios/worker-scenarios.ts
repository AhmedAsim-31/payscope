import { eq, sql } from 'drizzle-orm';
import { backgroundJobsTable } from '../db/schema/jobs';
import { claimJobs, recoverExpiredLeases } from '../jobs/job-queue';
import type { Scenario } from './lab';
import { attemptsOf, checkProcessed, findPayment, labPayment } from './record-lookup';
import { paymentSucceeded } from './stripe-payloads';

export const concurrentDuplicateProcessing: Scenario = async (lab) => {
  const { db, orgId } = lab.env;
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1);
  const first = await lab.ingest(paymentSucceeded(payment));
  const [second] = await db
    .insert(backgroundJobsTable)
    .values({
      orgId,
      kind: 'process_provider_event',
      payload: { eventId: first.eventId },
      idempotencyKey: `scenario-lab:duplicate-job:${first.eventId}`,
    })
    .returning({ id: backgroundJobsTable.id });
  if (!second) throw new Error('second job insert returned no row');
  lab.track('jobIds', second.id);
  await Promise.all([
    lab.drain([first.jobId], lab.worker(`scenario-lab-a-${lab.tag}`)),
    lab.drain([second.id], lab.worker(`scenario-lab-b-${lab.tag}`)),
  ]);
  const event = await lab.event(first.eventId);
  const jobs = await Promise.all([lab.job(first.jobId), lab.job(second.id)]);
  const attempts = await attemptsOf(lab, first.eventId);
  const record = await findPayment(lab, payment.id);
  lab.check(
    'Both jobs finished',
    jobs.every((j) => j.status === 'succeeded'),
    jobs.map((j) => j.status).join(', '),
  );
  lab.check('Event processed', event.status === 'processed', event.status);
  lab.check(
    'Exactly one payment record at version 0',
    record?.version === 0,
    `version ${record?.version}`,
  );
  lab.check(
    'Applied exactly once',
    attempts.filter((a) => a.outcome === 'succeeded').length === 1,
    `${attempts.length} attempts`,
  );
};

export const workerCrashRecovery: Scenario = async (lab) => {
  const { db } = lab.env;
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1);
  const ingested = await lab.ingest(paymentSucceeded(payment));
  const crashed = `scenario-lab-crashed-${lab.tag}`;
  const recovery = `scenario-lab-recovery-${lab.tag}`;
  await claimJobs(db, {
    workerId: crashed,
    limit: 1,
    leaseSeconds: 30,
    onlyJobIds: [ingested.jobId],
  });
  await db
    .update(backgroundJobsTable)
    .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
    .where(eq(backgroundJobsTable.id, ingested.jobId));
  const abandoned = await lab.job(ingested.jobId);
  lab.check(
    'Job held by the crashed worker',
    abandoned.status === 'running' && abandoned.lockedBy === crashed,
    `${abandoned.status} by ${abandoned.lockedBy}`,
  );
  await recoverExpiredLeases(db);
  const requeued = await lab.job(ingested.jobId);
  lab.check(
    'Expired lease requeued the job',
    requeued.status === 'queued' && requeued.lastError === 'lease_expired',
    requeued.status,
  );
  await lab.drain([ingested.jobId], lab.worker(recovery));
  await checkProcessed(lab, ingested);
  const done = await lab.job(ingested.jobId);
  lab.check(
    'Completed on a second attempt',
    done.attemptCount === 2,
    `attempt ${done.attemptCount}`,
  );
  lab.check('Payment recorded', (await findPayment(lab, payment.id))?.status === 'succeeded');
  lab.note(`Claimed by ${crashed}, completed by ${recovery}.`);
};
