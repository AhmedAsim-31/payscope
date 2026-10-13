import { createSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPayPalAdapter } from './paypal-adapter';
import { createCertificateFetcher } from './paypal-cert-fetcher';
import { paypalCrc32 } from './paypal-crc32';
import { loadTestCert } from './paypal-fixtures';

const { certPem, keyPem } = loadTestCert();
const WEBHOOK_ID = 'WH-WEBHOOKID-TEST';
const URL_OK = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST';
const TIME = '2100-01-01T00:00:00Z';
const NOW = new Date(TIME);
const rawBody = Buffer.from(
  JSON.stringify({
    id: 'WH-SANDBOX-0001',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    create_time: '2026-12-31T23:59:50Z',
    resource: { id: 'C1' },
  }),
);

function request(body: Buffer) {
  const message = `T-1|${TIME}|${WEBHOOK_ID}|${paypalCrc32(body)}`;
  return {
    rawBody: body,
    receivedAt: NOW,
    headers: {
      'paypal-transmission-id': 'T-1',
      'paypal-transmission-time': TIME,
      'paypal-transmission-sig': createSign('RSA-SHA256').update(message).sign(keyPem, 'base64'),
      'paypal-cert-url': URL_OK,
      'paypal-auth-algo': 'SHA256withRSA',
    },
  };
}

describe('paypalAdapter', () => {
  const adapter = createPayPalAdapter(() => Promise.resolve(certPem));

  it('declares honest capabilities', () => {
    expect(adapter.provider).toBe('paypal');
    expect(adapter.capabilities).toEqual({
      webhookVerification: 'supported_tested',
      eventNormalization: 'implemented_unverified',
      authoritativeFetch: 'implemented_unverified',
      credentialValidation: 'implemented_unverified',
      reconciliation: 'implemented_unverified',
      idMapping: 'unsupported',
    });
  });

  it('verifies a signed webhook using secrets[0] as webhook id', async () => {
    expect(await adapter.verifyWebhook(request(rawBody), [WEBHOOK_ID], NOW)).toEqual({
      ok: true,
      providerEventId: 'WH-SANDBOX-0001',
      occurredAt: new Date('2026-12-31T23:59:50Z'),
    });
    expect(await adapter.verifyWebhook(request(rawBody), ['WH-OTHER'], NOW)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
    expect(await adapter.verifyWebhook(request(rawBody), [], NOW)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('reports a validly signed non-envelope body as malformed', async () => {
    const result = await adapter.verifyWebhook(request(Buffer.from('{"a":1}')), [WEBHOOK_ID], NOW);
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('createCertificateFetcher', () => {
  it('caches per url for 24h and refetches after', async () => {
    let now = 0;
    const fetchMock = vi.fn(() => Promise.resolve(new Response(certPem)));
    const get = createCertificateFetcher(fetchMock, () => now);
    expect(await get(URL_OK)).toBe(certPem);
    await get(URL_OK);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now = 24 * 60 * 60 * 1000 + 1;
    await get(URL_OK);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('applies a timeout, refuses redirects, and rejects errors and oversized bodies', async () => {
    const ok = vi.fn(() => Promise.resolve(new Response(certPem)));
    await createCertificateFetcher(ok)(URL_OK);
    const [, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
    const bad = createCertificateFetcher(() => Promise.resolve(new Response('x', { status: 500 })));
    await expect(bad(URL_OK)).rejects.toThrow();
    const big = createCertificateFetcher(() => Promise.resolve(new Response('a'.repeat(65_537))));
    await expect(big(URL_OK)).rejects.toThrow();
  });
});
