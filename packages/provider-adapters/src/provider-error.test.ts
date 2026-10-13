import { describe, expect, it } from 'vitest';
import { classifyHttpStatus, ProviderError, type ProviderErrorCategory } from './provider-error';

describe('classifyHttpStatus', () => {
  const table: [number, ProviderErrorCategory][] = [
    [408, 'transient'],
    [429, 'transient'],
    [500, 'transient'],
    [503, 'transient'],
    [401, 'provider_auth'],
    [403, 'provider_auth'],
    [404, 'not_found'],
    [409, 'state_conflict'],
    [400, 'invalid_input'],
    [422, 'invalid_input'],
  ];

  it.each(table)('%i -> %s', (status, category) => {
    expect(classifyHttpStatus(status)).toBe(category);
  });
});

describe('ProviderError', () => {
  it('is retryable only when transient or unavailable', () => {
    expect(new ProviderError('transient', 'x').retryable).toBe(true);
    expect(new ProviderError('unavailable', 'x').retryable).toBe(true);
    expect(new ProviderError('permanent', 'x').retryable).toBe(false);
    expect(new ProviderError('provider_auth', 'x').retryable).toBe(false);
    expect(new ProviderError('invalid_input', 'x').retryable).toBe(false);
  });

  it('carries category and status', () => {
    const error = new ProviderError('not_found', 'missing', { status: 404 });
    expect(error).toBeInstanceOf(Error);
    expect(error.category).toBe('not_found');
    expect(error.status).toBe(404);
  });

  it('accepts only a known structured reason', () => {
    expect(new ProviderError('invalid_input', 'x', { reason: 'live_mode' }).reason).toBe(
      'live_mode',
    );
    // @ts-expect-error free-form reasons would let callers drift back to string matching
    expect(new ProviderError('invalid_input', 'x', { reason: 'livemode' }).reason).toBe('livemode');
  });

  it('builds from an HTTP status', () => {
    const error = ProviderError.fromHttpStatus(429, 'slow down');
    expect(error.category).toBe('transient');
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
  });
});
