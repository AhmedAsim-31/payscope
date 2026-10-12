import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../signature-utils';
import { stripeAdapter } from './stripe-adapter';

const SECRET = 'whsec_test_adapter';
const T = 1_760_000_000;
const rawBody = Buffer.from(JSON.stringify({ id: 'evt_test_9', livemode: false }));
const header = `t=${T},v1=${hmacSha256Hex(SECRET, Buffer.concat([Buffer.from(`${T}.`), rawBody]))}`;
const now = new Date(T * 1000);

describe('stripeAdapter.verifyWebhook', () => {
  it('returns the event id and timestamp, matching the header case-insensitively', async () => {
    const result = await stripeAdapter.verifyWebhook(
      { rawBody, headers: { 'Stripe-Signature': header }, receivedAt: now },
      [SECRET],
      now,
    );
    expect(result).toEqual({ ok: true, providerEventId: 'evt_test_9', occurredAt: now });
  });

  it('reports a missing header', async () => {
    const result = await stripeAdapter.verifyWebhook(
      { rawBody, headers: {}, receivedAt: now },
      [SECRET],
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('treats a validly signed non-JSON body as malformed', async () => {
    const body = Buffer.from('not json');
    const sig = hmacSha256Hex(SECRET, Buffer.concat([Buffer.from(`${T}.`), body]));
    const result = await stripeAdapter.verifyWebhook(
      { rawBody: body, headers: { 'stripe-signature': `t=${T},v1=${sig}` }, receivedAt: now },
      [SECRET],
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });
});
