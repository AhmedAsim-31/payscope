import { describe, expect, it, vi } from 'vitest';
import type { ProviderContext } from '../provider-context';
import { ProviderError } from '../provider-error';
import { fetchRevenueCatSubscription, validateRevenueCatCredentials } from './revenuecat-client';

const subscriber = {
  request_date_ms: 1760000000000,
  subscriber: {
    original_app_user_id: 'user_sandbox_001',
    entitlements: {
      pro: { expires_date: '2999-01-01T00:00:00Z', product_identifier: 'pro_monthly' },
    },
  },
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function ctxWith(fetchImpl: typeof fetch): ProviderContext {
  return {
    credentials: { apiKey: 'sk_test_rc' },
    baseUrl: 'https://api.revenuecat.com',
    fetch: fetchImpl,
  };
}

async function categoryOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ProviderError ? error.category : 'not-provider-error';
  }
  return undefined;
}

describe('revenuecat client', () => {
  it('fetches a subscriber with bearer auth and reports an active entitlement', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(subscriber)));
    const snapshot = await fetchRevenueCatSubscription(ctxWith(fetchMock), 'user_sandbox_001');
    expect(snapshot).toMatchObject({
      provider: 'revenuecat',
      objectId: 'user_sandbox_001',
      status: 'active',
      amountMinor: null,
      currency: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.revenuecat.com/v1/subscribers/user_sandbox_001');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk_test_rc' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
  });

  it('reports inactive when every entitlement is expired or none exist', async () => {
    const expired = {
      subscriber: {
        ...subscriber.subscriber,
        entitlements: { pro: { expires_date: '2000-01-01T00:00:00Z' } },
      },
    };
    const none = { subscriber: { ...subscriber.subscriber, entitlements: {} } };
    for (const body of [expired, none]) {
      const snapshot = await fetchRevenueCatSubscription(
        ctxWith(() => Promise.resolve(json(body))),
        'u',
      );
      expect(snapshot.status).toBe('inactive');
    }
  });

  it('treats a null expires_date (lifetime) as active', async () => {
    const lifetime = {
      subscriber: { ...subscriber.subscriber, entitlements: { pro: { expires_date: null } } },
    };
    const snapshot = await fetchRevenueCatSubscription(
      ctxWith(() => Promise.resolve(json(lifetime))),
      'u',
    );
    expect(snapshot.status).toBe('active');
  });

  it('validates credentials with the offerings read, which does not create a customer', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(json({ current_offering_id: null, offerings: [] })),
    );
    await validateRevenueCatCredentials(ctxWith(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.revenuecat.com/v1/subscribers/payscope-credential-check/offerings',
    );
    expect(init.method).toBe('GET');
  });

  it('rejects credentials the offerings read refuses', async () => {
    const ctx = ctxWith(() => Promise.resolve(json({ message: 'x' }, { status: 401 })));
    expect(await categoryOf(validateRevenueCatCredentials(ctx))).toBe('provider_auth');
  });

  it.each([
    [404, 'not_found'],
    [429, 'transient'],
    [500, 'transient'],
    [401, 'provider_auth'],
    [400, 'invalid_input'],
  ])('maps HTTP %i to %s', async (status, category) => {
    const ctx = ctxWith(() => Promise.resolve(json({ message: 'x' }, { status })));
    expect(await categoryOf(fetchRevenueCatSubscription(ctx, 'u'))).toBe(category);
  });

  it('marks 429 as retryable', async () => {
    const ctx = ctxWith(() => Promise.resolve(json({}, { status: 429 })));
    const error = await fetchRevenueCatSubscription(ctx, 'u').catch((e: unknown) => e);
    expect((error as ProviderError).retryable).toBe(true);
  });

  it('maps network failure and abort to unavailable', async () => {
    const network = ctxWith(() => Promise.reject(new TypeError('fetch failed')));
    expect(await categoryOf(fetchRevenueCatSubscription(network, 'u'))).toBe('unavailable');
    const timeout = ctxWith(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(await categoryOf(fetchRevenueCatSubscription(timeout, 'u'))).toBe('unavailable');
  });

  it('rejects a foreign base URL and an empty id without calling fetch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(subscriber)));
    const foreign = { ...ctxWith(fetchMock), baseUrl: 'https://api.stripe.com' } as ProviderContext;
    expect(await categoryOf(fetchRevenueCatSubscription(foreign, 'u'))).toBe('invalid_input');
    expect(await categoryOf(fetchRevenueCatSubscription(ctxWith(fetchMock), ''))).toBe(
      'invalid_input',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes ids so a slash or anonymous-id prefix cannot change the path', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(subscriber)));
    await fetchRevenueCatSubscription(ctxWith(fetchMock), '../x/$RCAnonymousID:abc');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.revenuecat.com/v1/subscribers/..%2Fx%2F%24RCAnonymousID%3Aabc',
    );
  });

  it('rejects oversize bodies by content-length and by streamed size', async () => {
    const declared = ctxWith(() =>
      Promise.resolve(json(subscriber, { headers: { 'content-length': '2000000' } })),
    );
    expect(await categoryOf(fetchRevenueCatSubscription(declared, 'u'))).toBe('permanent');
    const big = JSON.stringify({ ...subscriber, pad: 'x'.repeat(1_100_000) });
    const streamed = ctxWith(() => Promise.resolve(new Response(big)));
    expect(await categoryOf(fetchRevenueCatSubscription(streamed, 'u'))).toBe('permanent');
  });

  it('rejects unexpected shapes and non-JSON bodies', async () => {
    const wrongShape = ctxWith(() => Promise.resolve(json({ subscriber: {} })));
    expect(await categoryOf(fetchRevenueCatSubscription(wrongShape, 'u'))).toBe('permanent');
    const notJson = ctxWith(() => Promise.resolve(new Response('<html>')));
    expect(await categoryOf(fetchRevenueCatSubscription(notJson, 'u'))).toBe('permanent');
  });
});
