export type Obj = Record<string, unknown>;

export type LabPayment = {
  id: string;
  customer: string;
  amount: number;
  at: Date;
};

export type LabSubscription = {
  id: string;
  customer: string;
  price: string;
  status: string;
  periodEnd: Date;
};

const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

function envelope(id: string, type: string, at: Date, object: Obj): Obj {
  return {
    id,
    object: 'event',
    api_version: '2025-09-30.clover',
    created: seconds(at),
    type,
    livemode: false,
    pending_webhooks: 1,
    data: { object },
  };
}

export const paymentEventId = (p: LabPayment) => `evt_lab_${p.id}`;

export function paymentSucceeded(p: LabPayment): Obj {
  return envelope(paymentEventId(p), 'payment_intent.succeeded', p.at, {
    id: p.id,
    object: 'payment_intent',
    amount: p.amount,
    amount_received: p.amount,
    currency: 'usd',
    customer: p.customer,
    status: 'succeeded',
    created: seconds(p.at),
    livemode: false,
    metadata: {},
  });
}

export function paymentFailed(p: LabPayment): Obj {
  return envelope(paymentEventId(p), 'payment_intent.payment_failed', p.at, {
    id: p.id,
    object: 'payment_intent',
    amount: p.amount,
    amount_received: 0,
    currency: 'usd',
    customer: p.customer,
    status: 'requires_payment_method',
    created: seconds(p.at),
    livemode: false,
    metadata: {},
    last_payment_error: { code: 'card_declined' },
  });
}

export function paymentRefunded(p: LabPayment, at: Date): Obj {
  return envelope(`evt_lab_re_${p.id}`, 'charge.refunded', at, {
    id: `ch_lab_${p.id}`,
    object: 'charge',
    amount: p.amount,
    amount_captured: p.amount,
    amount_refunded: p.amount,
    currency: 'usd',
    customer: p.customer,
    payment_intent: p.id,
    status: 'succeeded',
    refunded: true,
    created: seconds(p.at),
    livemode: false,
  });
}

export function subscriptionEvent(
  kind: 'created' | 'updated' | 'deleted',
  s: LabSubscription,
  at: Date,
): Obj {
  return envelope(`evt_lab_${kind}_${s.id}_${s.status}`, `customer.subscription.${kind}`, at, {
    id: s.id,
    object: 'subscription',
    customer: s.customer,
    status: s.status,
    currency: 'usd',
    cancel_at_period_end: false,
    created: seconds(at),
    livemode: false,
    items: {
      object: 'list',
      data: [
        {
          id: `si_${s.id}`,
          object: 'subscription_item',
          current_period_end: seconds(s.periodEnd),
          price: { id: s.price, object: 'price', currency: 'usd', unit_amount: 1999 },
          quantity: 1,
        },
      ],
      has_more: false,
    },
  });
}
