import { checkProcessed, findPayment, labPayment } from './record-lookup';
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
  await checkProcessed(lab, await lab.deliver(paymentRefunded(payment, refundAt)), 'Early refund');
  const late = await lab.deliver(paymentSucceeded(payment));
  const event = await lab.event(late.eventId);
  lab.check('Late payment event recognised as stale', event.status === 'ignored', event.status);
  const record = await findPayment(lab, payment.id);
  lab.check('Payment ends refunded, not succeeded', record?.status === 'refunded', record?.status);
};
