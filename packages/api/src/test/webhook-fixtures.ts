import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadStripeFixture } from '@payscope/provider-adapters/stripe/stripe-fixtures';

export const STRIPE_SECRET = 'whsec_test_primary_secret';
export const PADDLE_SECRET = 'pdl_ntfset_test_primary_secret';

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function stripeEvent(
  fixture = 'payment-intent-succeeded',
): Record<string, unknown> & { id: string } {
  return { ...loadStripeFixture(fixture), id: `evt_${randomUUID()}` };
}

export function paddleEvent(
  fixture = 'transaction-completed',
): Record<string, unknown> & { event_id: string } {
  const text = readFileSync(
    new URL(`../../../provider-adapters/src/paddle/fixtures/${fixture}.json`, import.meta.url),
    'utf8',
  );
  return { ...(JSON.parse(text) as Record<string, unknown>), event_id: `evt_${randomUUID()}` };
}

export function stripeHeaders(body: string, secret = STRIPE_SECRET, ts = nowSeconds()) {
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` };
}

export function paddleHeaders(body: string, secret = PADDLE_SECRET, ts = nowSeconds()) {
  const sig = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  return { 'content-type': 'application/json', 'paddle-signature': `ts=${ts};h1=${sig}` };
}
