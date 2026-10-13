/* eslint-disable @typescript-eslint/require-await -- fake fetch stubs must return promises */
import { describe, expect, it, vi } from 'vitest';
import type { ProviderContext } from '../provider-context';
import { ProviderError } from '../provider-error';
import {
  fetchPaddlePayment,
  fetchPaddleSubscription,
  validatePaddleCredentials,
} from './paddle-client';

const KEY = 'pdl_sdbx_apikey_test';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ctxWith = (
  fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response>,
): ProviderContext => ({
  credentials: { apiKey: KEY },
  baseUrl: 'https://sandbox-api.paddle.com',
  fetch: vi.fn(fetchImpl),
});

const txn = {
  data: {
    id: 'txn_1',
    status: 'completed',
    currency_code: 'usd',
    details: { totals: { grand_total: '2499' } },
  },
};

describe('paddle client', () => {
  it('fetches a transaction into a snapshot with bearer auth', async () => {
    const ctx = ctxWith(async () => json(txn));
    const snap = await fetchPaddlePayment(ctx, 'txn_1');
    expect(snap).toMatchObject({
      provider: 'paddle',
      objectId: 'txn_1',
      status: 'completed',
      amountMinor: 2499n,
      currency: 'USD',
    });
    expect(snap.raw['id']).toBe('txn_1');
    const [url, init] = vi.mocked(ctx.fetch).mock.calls[0] ?? [];
    expect(url).toBe('https://sandbox-api.paddle.com/transactions/txn_1');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('fetches a subscription', async () => {
    const ctx = ctxWith(async () =>
      json({ data: { id: 'sub_1', status: 'active', currency_code: 'EUR' } }),
    );
    expect(await fetchPaddleSubscription(ctx, 'sub_1')).toMatchObject({
      objectId: 'sub_1',
      status: 'active',
      amountMinor: null,
      currency: 'EUR',
    });
  });

  it('encodes the id in the path', async () => {
    const ctx = ctxWith(async () => json(txn));
    await fetchPaddlePayment(ctx, 'a/b?c');
    expect(vi.mocked(ctx.fetch).mock.calls[0]?.[0]).toBe(
      'https://sandbox-api.paddle.com/transactions/a%2Fb%3Fc',
    );
  });

  it('validates credentials against /event-types', async () => {
    const ctx = ctxWith(async () => json({ data: [] }));
    await expect(validatePaddleCredentials(ctx)).resolves.toBeUndefined();
    expect(vi.mocked(ctx.fetch).mock.calls[0]?.[0]).toBe(
      'https://sandbox-api.paddle.com/event-types',
    );
  });

  it.each([
    [404, 'not_found', false],
    [401, 'provider_auth', false],
    [429, 'transient', true],
    [500, 'transient', true],
  ])('maps HTTP %i to %s', async (status, category, retryable) => {
    const ctx = ctxWith(async () => json({ error: {} }, status));
    const error = await fetchPaddlePayment(ctx, 'txn_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ category, status, retryable });
  });

  it('maps network and abort failures to unavailable', async () => {
    for (const failure of [
      new TypeError('fetch failed'),
      new DOMException('timeout', 'TimeoutError'),
    ]) {
      const ctx = ctxWith(async () => {
        throw failure;
      });
      const error = await fetchPaddlePayment(ctx, 'txn_1').catch((e: unknown) => e);
      expect(error).toMatchObject({ category: 'unavailable', retryable: true });
    }
  });

  it('rejects the live base URL before any network call', async () => {
    const ctx = { ...ctxWith(async () => json(txn)), baseUrl: 'https://api.paddle.com' as const };
    await expect(fetchPaddlePayment(ctx, 'txn_1')).rejects.toMatchObject({
      category: 'invalid_input',
    });
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('rejects a live-format key before any network call', async () => {
    const ctx = ctxWith(async () => json(txn));
    ctx.credentials.apiKey = 'pdl_live_apikey_x';
    await expect(validatePaddleCredentials(ctx)).rejects.toMatchObject({
      category: 'invalid_input',
    });
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversize response', async () => {
    const ctx = ctxWith(async () => new Response('x'.repeat(1_048_577)));
    await expect(fetchPaddlePayment(ctx, 'txn_1')).rejects.toMatchObject({ category: 'permanent' });
  });

  it('rejects invalid JSON and unexpected shapes as permanent', async () => {
    await expect(
      fetchPaddlePayment(
        ctxWith(async () => new Response('nope')),
        'txn_1',
      ),
    ).rejects.toMatchObject({
      category: 'permanent',
    });
    await expect(
      fetchPaddlePayment(
        ctxWith(async () => json({ data: {} })),
        'txn_1',
      ),
    ).rejects.toMatchObject({
      category: 'permanent',
    });
  });

  it('rejects a non-integer grand_total', async () => {
    const bad = { data: { ...txn.data, details: { totals: { grand_total: '10.5' } } } };
    await expect(
      fetchPaddlePayment(
        ctxWith(async () => json(bad)),
        'txn_1',
      ),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
