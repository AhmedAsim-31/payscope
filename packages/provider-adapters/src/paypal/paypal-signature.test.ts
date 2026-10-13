import { createSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { paypalCrc32 } from './paypal-crc32';
import { loadTestCert } from './paypal-fixtures';
import { verifyPayPalSignature } from './paypal-signature';

const { certPem, keyPem } = loadTestCert();
const WEBHOOK_ID = 'WH-WEBHOOKID-TEST';
const CERT_URL = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST';
const BODY = Buffer.from('{"id":"WH-SANDBOX-0001","event_type":"PAYMENT.CAPTURE.COMPLETED"}');
const TIME = '2100-01-01T00:00:00Z';
const NOW = new Date(TIME);

function signedHeaders(
  overrides: Record<string, string> = {},
  body = BODY,
  webhookId = WEBHOOK_ID,
) {
  const message = `TRANSMISSION-1|${TIME}|${webhookId}|${paypalCrc32(body)}`;
  const sig = createSign('RSA-SHA256').update(message).sign(keyPem, 'base64');
  return {
    'paypal-transmission-id': 'TRANSMISSION-1',
    'paypal-transmission-time': TIME,
    'paypal-transmission-sig': sig,
    'paypal-cert-url': CERT_URL,
    'paypal-auth-algo': 'SHA256withRSA',
    ...overrides,
  };
}

function run(
  headers: Record<string, string>,
  extra: { rawBody?: Buffer; webhookId?: string; now?: Date } = {},
) {
  const getCertificate = vi.fn(() => Promise.resolve(certPem));
  const result = verifyPayPalSignature({
    rawBody: extra.rawBody ?? BODY,
    headers,
    webhookId: extra.webhookId ?? WEBHOOK_ID,
    now: extra.now ?? NOW,
    getCertificate,
  });
  return { result, getCertificate };
}

describe('paypalCrc32', () => {
  it('matches the standard check value and the empty input', () => {
    expect(paypalCrc32(Buffer.from('123456789'))).toBe(3421780262);
    expect(paypalCrc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('verifyPayPalSignature', () => {
  it('accepts a correctly signed body and fetches the cert once', async () => {
    const { result, getCertificate } = run(signedHeaders());
    expect(await result).toEqual({ ok: true });
    expect(getCertificate).toHaveBeenCalledWith(CERT_URL);
  });

  it('accepts mixed-case header names', async () => {
    const upper = Object.fromEntries(
      Object.entries(signedHeaders()).map(([k, v]) => [k.toUpperCase(), v]),
    );
    expect(await run(upper).result).toEqual({ ok: true });
  });

  it('rejects a tampered body', async () => {
    const { result } = run(signedHeaders(), { rawBody: Buffer.from(`${BODY.toString()} `) });
    expect(await result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects the wrong webhook id', async () => {
    const { result } = run(signedHeaders(), { webhookId: 'WH-OTHER' });
    expect(await result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a malformed signature without throwing', async () => {
    const { result } = run(signedHeaders({ 'paypal-transmission-sig': 'not-base64!!' }));
    expect(await result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a stale transmission time', async () => {
    const { result } = run(signedHeaders(), { now: new Date(NOW.getTime() + 301_000) });
    expect(await result).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('rejects an unparseable transmission time', async () => {
    const { result } = run(signedHeaders({ 'paypal-transmission-time': 'yesterday' }));
    expect(await result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a non-SHA256withRSA algorithm', async () => {
    const { result } = run(signedHeaders({ 'paypal-auth-algo': 'SHA1withRSA' }));
    expect(await result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it.each([
    'paypal-transmission-id',
    'paypal-transmission-time',
    'paypal-transmission-sig',
    'paypal-cert-url',
    'paypal-auth-algo',
  ])('reports a missing %s', async (name) => {
    const headers: Record<string, string> = signedHeaders();
    delete headers[name];
    expect(await run(headers).result).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('reports a missing webhook id', async () => {
    expect(await run(signedHeaders(), { webhookId: '' }).result).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it.each([
    'https://api.paypal.com.evil.test/cert',
    'https://evil.test/api.paypal.com',
    'http://api.paypal.com/cert',
    'https://user@api.paypal.com/cert',
    'https://user:pw@api.paypal.com/cert',
    'https://api.paypal.com:8443/cert',
    'https://sub.api.paypal.com/cert',
    'https://paypal.com/cert',
    'ftp://api.paypal.com/cert',
    'not a url',
  ])('rejects cert url %s without fetching it', async (url) => {
    const { result, getCertificate } = run(signedHeaders({ 'paypal-cert-url': url }));
    expect(await result).toEqual({ ok: false, reason: 'invalid_signature' });
    expect(getCertificate).not.toHaveBeenCalled();
  });

  it.each([
    'https://api.paypal.com/v1/notifications/certs/C',
    'https://api.sandbox.paypal.com/v1/notifications/certs/C',
    'https://api-m.paypal.com/v1/notifications/certs/C',
    'https://api-m.sandbox.paypal.com/v1/notifications/certs/C',
  ])('allows cert url %s', async (url) => {
    expect((await run(signedHeaders({ 'paypal-cert-url': url })).result).ok).toBe(true);
  });

  it('rejects when the certificate has expired', async () => {
    const far = new Date('2200-01-01T00:00:00Z');
    const { result } = run(signedHeaders({ 'paypal-transmission-time': far.toISOString() }), {
      now: far,
    });
    expect(await result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects when the certificate is not yet valid', async () => {
    const early = new Date('2020-01-01T00:00:00Z');
    const { result } = run(signedHeaders({ 'paypal-transmission-time': early.toISOString() }), {
      now: early,
    });
    expect(await result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects when the certificate cannot be fetched or parsed', async () => {
    const input = {
      rawBody: BODY,
      headers: signedHeaders(),
      webhookId: WEBHOOK_ID,
      now: NOW,
    };
    const failing = await verifyPayPalSignature({
      ...input,
      getCertificate: () => Promise.reject(new Error('down')),
    });
    const garbage = await verifyPayPalSignature({
      ...input,
      getCertificate: () => Promise.resolve('garbage'),
    });
    expect(failing).toEqual({ ok: false, reason: 'invalid_signature' });
    expect(garbage).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});
