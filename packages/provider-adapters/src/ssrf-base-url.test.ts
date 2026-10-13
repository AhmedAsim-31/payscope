import { describe, expect, it, vi } from 'vitest';
import { paddleAdapter } from './paddle/paddle-adapter';
import { paypalAdapter } from './paypal/paypal-adapter';
import type { ProviderContext } from './provider-context';
import { revenueCatAdapter } from './revenuecat/revenuecat-adapter';
import { stripeAdapter } from './stripe/stripe-adapter';

const FOREIGN_BASE_URLS = [
  'http://169.254.169.254',
  'http://localhost:8080',
  'https://api.stripe.com.evil.test',
  'https://evil.test',
];

const adapters = [stripeAdapter, paddleAdapter, paypalAdapter, revenueCatAdapter];
const cases = adapters.flatMap((adapter) =>
  FOREIGN_BASE_URLS.map((url) => [adapter.provider, url] as const),
);

describe('adapter base URL allow-list', () => {
  it.each(cases)('%s never fetches from %s', async (provider, url) => {
    const adapter = adapters.find((a) => a.provider === provider);
    if (!adapter) throw new Error('adapter missing');
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
    const base: ProviderContext = {
      credentials: { apiKey: 'sk_test_x:secret' },
      baseUrl: 'https://api.stripe.com',
      fetch: fetchMock,
    };
    const ctx = { ...base, baseUrl: url } as ProviderContext;
    const calls = [adapter.fetchPayment?.(ctx, 'obj_1'), adapter.fetchSubscription?.(ctx, 'obj_1')];
    for (const call of calls) {
      if (call) await expect(call).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
