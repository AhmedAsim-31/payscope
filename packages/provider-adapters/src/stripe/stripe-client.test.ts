import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../provider-error';
import type { ProviderContext } from '../provider-context';
import { loadStripeFixture } from './stripe-fixtures';
import {
  fetchPayment,
  fetchPaymentSubscription,
  fetchSubscription,
  listPayments,
  validateCredentials,
} from './stripe-client';

const paymentIntent = {
  id: 'pi_test_1',
  status: 'succeeded',
  amount: 4999,
  amount_received: 4999,
  currency: 'usd',
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function ctxWith(fetchImpl: typeof fetch, apiKey = 'sk_test_abc'): ProviderContext {
  return { credentials: { apiKey }, baseUrl: 'https://api.stripe.com', fetch: fetchImpl };
}

async function categoryOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ProviderError ? error.category : 'not-provider-error';
  }
  return undefined;
}

describe('stripe client', () => {
  it('fetches and parses a payment intent with bearer auth', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(paymentIntent)));
    const snapshot = await fetchPayment(ctxWith(fetchMock), 'pi_test_1');
    expect(snapshot).toMatchObject({
      provider: 'stripe',
      objectId: 'pi_test_1',
      status: 'succeeded',
      amountMinor: 4999n,
      currency: 'USD',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/payment_intents/pi_test_1');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk_test_abc' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
  });

  it('lists payment intents created inside the window and pages with starting_after', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(json({ object: 'list', has_more: true, data: [paymentIntent] })),
    );
    const window = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T00:00:00Z') };
    const page = await listPayments(ctxWith(fetchMock), window, 'pi_prev');
    expect(page.items).toMatchObject([{ objectId: 'pi_test_1', amountMinor: 4999n }]);
    expect(page.nextCursor).toBe('pi_test_1');
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe('/v1/payment_intents');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '100',
      'created[gte]': '1767225600',
      'created[lt]': '1769817600',
      starting_after: 'pi_prev',
    });
  });

  it('ends listing when has_more is false', async () => {
    const ctx = ctxWith(() => Promise.resolve(json({ has_more: false, data: [paymentIntent] })));
    const window = { from: new Date(0), to: new Date(1000) };
    expect((await listPayments(ctx, window, null)).nextCursor).toBeNull();
  });

  it('fetches a subscription', async () => {
    const body = { id: 'sub_test_1', status: 'active', currency: 'usd' };
    const snapshot = await fetchSubscription(
      ctxWith(() => Promise.resolve(json(body))),
      'sub_test_1',
    );
    expect(snapshot).toMatchObject({ objectId: 'sub_test_1', status: 'active', amountMinor: null });
  });

  it('resolves a payment intent subscription through its expanded invoice payment', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(json(loadStripeFixture('invoice-payments-list-expanded'))),
    );
    expect(await fetchPaymentSubscription(ctxWith(fetchMock), 'pi_test_3Qa1b2c3d4')).toBe(
      'sub_test_1Pq9zXy',
    );
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe('/v1/invoice_payments');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'payment[type]': 'payment_intent',
      'payment[payment_intent]': 'pi_test_3Qa1b2c3d4',
      'expand[]': 'data.invoice',
      limit: '1',
    });
  });

  it('returns null for a payment intent with no invoice payment', async () => {
    const ctx = ctxWith(() => Promise.resolve(json({ object: 'list', has_more: false, data: [] })));
    expect(await fetchPaymentSubscription(ctx, 'pi_one_off')).toBeNull();
  });

  it('validates credentials against /v1/balance', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({ object: 'balance' })));
    await validateCredentials(ctxWith(fetchMock));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.stripe.com/v1/balance',
    );
  });

  it.each([
    [404, 'not_found'],
    [429, 'transient'],
    [500, 'transient'],
    [401, 'provider_auth'],
    [400, 'invalid_input'],
  ])('maps HTTP %i to %s', async (status, category) => {
    const ctx = ctxWith(() => Promise.resolve(json({ error: {} }, { status })));
    expect(await categoryOf(fetchPayment(ctx, 'pi_test_1'))).toBe(category);
  });

  it('marks 429 as retryable', async () => {
    const ctx = ctxWith(() => Promise.resolve(json({}, { status: 429 })));
    const error = await fetchPayment(ctx, 'x').catch((e: unknown) => e);
    expect((error as ProviderError).retryable).toBe(true);
  });

  it('maps network failure and abort to unavailable', async () => {
    const network = ctxWith(() => Promise.reject(new TypeError('fetch failed')));
    expect(await categoryOf(fetchPayment(network, 'pi_test_1'))).toBe('unavailable');
    const timeout = ctxWith(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(await categoryOf(fetchPayment(timeout, 'pi_test_1'))).toBe('unavailable');
  });

  it.each(['sk_live_abc', 'rk_live_abc'])('rejects %s before any network call', async (key) => {
    const fetchMock = vi.fn(() => Promise.resolve(json(paymentIntent)));
    const ctx = ctxWith(fetchMock, key);
    expect(await categoryOf(fetchPayment(ctx, 'pi_test_1'))).toBe('invalid_input');
    await expect(validateCredentials(ctx)).rejects.toThrow(/live keys are not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a foreign base URL without calling fetch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(paymentIntent)));
    const ctx = {
      ...ctxWith(fetchMock),
      baseUrl: 'https://api.paddle.com',
    } as ProviderContext;
    expect(await categoryOf(fetchPayment(ctx, 'pi_test_1'))).toBe('invalid_input');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes ids so a slash cannot change the path', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(paymentIntent)));
    await fetchPayment(ctxWith(fetchMock), '../customers/cus_1');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.stripe.com/v1/payment_intents/..%2Fcustomers%2Fcus_1',
    );
  });

  it('rejects oversize bodies by content-length and by streamed size', async () => {
    const declared = ctxWith(() =>
      Promise.resolve(json(paymentIntent, { headers: { 'content-length': '2000000' } })),
    );
    expect(await categoryOf(fetchPayment(declared, 'pi_test_1'))).toBe('permanent');
    const big = JSON.stringify({ ...paymentIntent, pad: 'x'.repeat(1_100_000) });
    const streamed = ctxWith(() => Promise.resolve(new Response(big)));
    expect(await categoryOf(fetchPayment(streamed, 'pi_test_1'))).toBe('permanent');
  });

  it('rejects unexpected shapes and non-JSON bodies', async () => {
    const wrongShape = ctxWith(() => Promise.resolve(json({ id: 'pi_1', amount: 1.5 })));
    expect(await categoryOf(fetchPayment(wrongShape, 'pi_1'))).toBe('permanent');
    const notJson = ctxWith(() => Promise.resolve(new Response('<html>')));
    expect(await categoryOf(fetchPayment(notJson, 'pi_1'))).toBe('permanent');
  });
});
