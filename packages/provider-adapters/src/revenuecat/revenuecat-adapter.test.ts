import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../signature-utils';
import { revenueCatAdapter } from './revenuecat-adapter';

const SECRET = 'rc_adapter_secret';
const T = 1_760_000_000;
const now = new Date(T * 1000);
const rawBody = Buffer.from(
  JSON.stringify({
    event: {
      id: 'evt-9',
      type: 'RENEWAL',
      app_user_id: 'u1',
      event_timestamp_ms: 1760000000100,
      environment: 'SANDBOX',
    },
  }),
);

describe('revenueCatAdapter', () => {
  it('verifies via Authorization and returns the event id and time', async () => {
    const result = await revenueCatAdapter.verifyWebhook(
      { rawBody, headers: { authorization: SECRET }, receivedAt: now },
      [SECRET],
      now,
    );
    expect(result).toEqual({
      ok: true,
      providerEventId: 'evt-9',
      occurredAt: new Date(1760000000100),
    });
  });

  it('verifies via HMAC signature', async () => {
    const sig = hmacSha256Hex(SECRET, Buffer.concat([Buffer.from(`${T}.`), rawBody]));
    const result = await revenueCatAdapter.verifyWebhook(
      {
        rawBody,
        headers: { 'x-revenuecat-webhook-signature': `t=${T},v1=${sig}` },
        receivedAt: now,
      },
      [SECRET],
      now,
    );
    expect(result.ok).toBe(true);
  });

  it('reports a missing credential', async () => {
    const result = await revenueCatAdapter.verifyWebhook(
      { rawBody, headers: {}, receivedAt: now },
      [SECRET],
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('treats an authorized non-JSON body as malformed', async () => {
    const result = await revenueCatAdapter.verifyWebhook(
      { rawBody: Buffer.from('nope'), headers: { authorization: SECRET }, receivedAt: now },
      [SECRET],
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('declares honest capabilities and no fetchPayment', () => {
    expect(revenueCatAdapter.capabilities).toEqual({
      webhookVerification: 'supported_tested',
      eventNormalization: 'supported_tested',
      authoritativeFetch: 'implemented_unverified',
      credentialValidation: 'implemented_unverified',
      reconciliation: 'implemented_unverified',
      idMapping: 'unsupported',
    });
    expect('fetchPayment' in revenueCatAdapter).toBe(false);
  });
});
