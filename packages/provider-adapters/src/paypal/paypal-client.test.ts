import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderContext } from '../provider-context';
import { ProviderError } from '../provider-error';
import {
  clearPayPalTokenCache,
  fetchPayPalPayment,
  fetchPayPalSubscription,
  validatePayPalCredentials,
} from './paypal-client';

const BASE = 'https://api-m.sandbox.paypal.com';
const token = { access_token: 'A21-token', token_type: 'Bearer', expires_in: 3600 };
const capture = {
  id: '5SANDBOXCAPTURE001',
  status: 'COMPLETED',
  amount: { currency_code: 'USD', value: '24.99' },
};

const urlOf = (input: string | URL | Request): string => (typeof input === 'string' ? input : '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function ctxWith(fetchImpl: typeof fetch, apiKey = 'client-id:client-secret'): ProviderContext {
  return { credentials: { apiKey }, baseUrl: BASE, fetch: fetchImpl };
}

function route(handlers: Record<string, () => Response>) {
  return vi.fn((url: string | URL | Request) => {
    const path = urlOf(url).replace(BASE, '');
    const handler = handlers[path];
    return Promise.resolve(handler ? handler() : json({}, 404));
  });
}

async function categoryOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ProviderError ? error.category : 'not-provider-error';
  }
  return undefined;
}

describe('paypal client', () => {
  beforeEach(() => {
    clearPayPalTokenCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('fetches a token with basic auth, then a capture with the bearer token', async () => {
    const fetchMock = route({
      '/v1/oauth2/token': () => json(token),
      '/v2/payments/captures/5SANDBOXCAPTURE001': () => json(capture),
    });
    const snapshot = await fetchPayPalPayment(ctxWith(fetchMock), '5SANDBOXCAPTURE001');
    expect(snapshot).toMatchObject({
      provider: 'paypal',
      objectId: '5SANDBOXCAPTURE001',
      status: 'COMPLETED',
      amountMinor: 2499n,
      currency: 'USD',
    });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe(`${BASE}/v1/oauth2/token`);
    expect(tokenInit.method).toBe('POST');
    expect(tokenInit.body).toBe('grant_type=client_credentials');
    expect(tokenInit.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    });
    const [, captureInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(captureInit.headers).toMatchObject({ Authorization: 'Bearer A21-token' });
    expect(tokenInit.redirect).toBe('error');
    expect(captureInit.redirect).toBe('error');
  });

  it('caches the token until 60s before expiry', async () => {
    const fetchMock = route({
      '/v1/oauth2/token': () => json(token),
      '/v1/billing/subscriptions/I-1': () => json({ id: 'I-1', status: 'ACTIVE' }),
    });
    const ctx = ctxWith(fetchMock);
    await fetchPayPalSubscription(ctx, 'I-1');
    await fetchPayPalSubscription(ctx, 'I-1');
    expect(fetchMock.mock.calls.filter(([u]) => urlOf(u).endsWith('/oauth2/token'))).toHaveLength(
      1,
    );
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z').getTime() + (3600 - 59) * 1000);
    await fetchPayPalSubscription(ctx, 'I-1');
    expect(fetchMock.mock.calls.filter(([u]) => urlOf(u).endsWith('/oauth2/token'))).toHaveLength(
      2,
    );
  });

  it('returns a subscription snapshot without an amount', async () => {
    const fetchMock = route({
      '/v1/oauth2/token': () => json(token),
      '/v1/billing/subscriptions/I-1': () => json({ id: 'I-1', status: 'ACTIVE' }),
    });
    expect(await fetchPayPalSubscription(ctxWith(fetchMock), 'I-1')).toMatchObject({
      objectId: 'I-1',
      status: 'ACTIVE',
      amountMinor: null,
      currency: null,
    });
  });

  it('classifies a 401 on the token endpoint as provider_auth', async () => {
    const fetchMock = route({ '/v1/oauth2/token': () => json({ error: 'invalid_client' }, 401) });
    expect(await categoryOf(validatePayPalCredentials(ctxWith(fetchMock)))).toBe('provider_auth');
  });

  it('validates credentials by fetching a token', async () => {
    const fetchMock = route({ '/v1/oauth2/token': () => json(token) });
    await expect(validatePayPalCredentials(ctxWith(fetchMock))).resolves.toBeUndefined();
  });

  it('maps 404 to not_found and 503 to transient', async () => {
    const missing = route({ '/v1/oauth2/token': () => json(token) });
    expect(await categoryOf(fetchPayPalPayment(ctxWith(missing), 'nope'))).toBe('not_found');
    clearPayPalTokenCache();
    const down = route({
      '/v1/oauth2/token': () => json(token),
      '/v2/payments/captures/x': () => json({}, 503),
    });
    expect(await categoryOf(fetchPayPalPayment(ctxWith(down), 'x'))).toBe('transient');
  });

  it('rejects an unexpected response shape and network failures', async () => {
    const odd = route({
      '/v1/oauth2/token': () => json(token),
      '/v2/payments/captures/x': () => json({ id: 'x' }),
    });
    expect(await categoryOf(fetchPayPalPayment(ctxWith(odd), 'x'))).toBe('permanent');
    clearPayPalTokenCache();
    const broken = vi.fn(() => Promise.reject(new Error('network')));
    expect(await categoryOf(validatePayPalCredentials(ctxWith(broken)))).toBe('unavailable');
  });

  it('refuses non-sandbox base urls and malformed credentials without calling fetch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(token)));
    const live = { ...ctxWith(fetchMock), baseUrl: 'https://api-m.paypal.com' } as const;
    expect(await categoryOf(validatePayPalCredentials(live))).toBe('invalid_input');
    expect(await categoryOf(validatePayPalCredentials(ctxWith(fetchMock, 'nocolon')))).toBe(
      'invalid_input',
    );
    expect(await categoryOf(validatePayPalCredentials(ctxWith(fetchMock, 'id:')))).toBe(
      'invalid_input',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
