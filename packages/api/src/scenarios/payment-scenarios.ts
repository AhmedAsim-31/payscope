import { checkProcessed, findPayment, labPayment } from './record-lookup';
import { makeRetryableNow } from './failure-scenarios';
import type { Scenario } from './lab';
import { paymentFailed, paymentRefunded, paymentSucceeded } from './stripe-payloads';

export const successfulPayment: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1);
  await checkProcessed(lab, await lab.deliver(paymentSucceeded(payment)));
  const record = await findPayment(lab, payment.id);
  lab.check('Payment record is succeeded', record?.status === 'succeeded', record?.status);
  lab.check('Amount recorded in minor units', record?.amountMinor === BigInt(payment.amount));
};

export const failedPayment: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1);
  await checkProcessed(lab, await lab.deliver(paymentFailed(payment)));
  const record = await findPayment(lab, payment.id);
  lab.check('Payment record is failed', record?.status === 'failed', record?.status);
};

export const refund: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1, 10);
  await checkProcessed(lab, await lab.deliver(paymentSucceeded(payment)), 'Payment event');
  const refundAt = new Date(payment.at.getTime() + 5 * 60_000);
  await checkProcessed(lab, await lab.deliver(paymentRefunded(payment, refundAt)), 'Refund event');
  const record = await findPayment(lab, payment.id);
  lab.check('Payment record is refunded', record?.status === 'refunded', record?.status);
  lab.check(
    'Full amount recorded as refunded',
    record?.amountRefundedMinor === BigInt(payment.amount),
    String(record?.amountRefundedMinor),
  );
};

export const outOfOrderWebhook: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payment = labPayment(lab, customer, 1, 10);
  const refundAt = new Date(payment.at.getTime() + 5 * 60_000);
  const early = await lab.deliver(paymentRefunded(payment, refundAt));
  const deferred = await lab.job(early.jobId);
  lab.check(
    'Early refund deferred for retry',
    deferred.status === 'queued',
    `job ${deferred.status}`,
  );
  lab.check(
    'No payment invented from the refund',
    (await findPayment(lab, payment.id)) === undefined,
  );
  await checkProcessed(lab, await lab.deliver(paymentSucceeded(payment)), 'Late payment event');
  await makeRetryableNow(lab, early.jobId);
  await lab.drain([early.jobId]);
  await checkProcessed(lab, early, 'Retried refund');
  const record = await findPayment(lab, payment.id);
  lab.check('Payment ends refunded, not succeeded', record?.status === 'refunded', record?.status);
  lab.check(
    'Amount comes from the payment event',
    record?.amountMinor === BigInt(payment.amount),
    String(record?.amountMinor),
  );
};
