import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from './adapter';
import { ProviderError } from './provider-error';
import { createAdapterRegistry } from './registry';

const stripe: ProviderAdapter = {
  provider: 'stripe',
  capabilities: {
    webhookVerification: 'supported_tested',
    eventNormalization: 'supported_tested',
    authoritativeFetch: 'unsupported',
    reconciliation: 'unsupported',
    credentialValidation: 'unsupported',
    idMapping: 'unsupported',
  },
  verifyWebhook: () => Promise.resolve({ ok: false, reason: 'malformed' }),
  normalizeEvent: () => {
    throw new ProviderError('unsupported_event', 'n/a');
  },
};

describe('createAdapterRegistry', () => {
  it('returns a registered adapter', () => {
    expect(createAdapterRegistry([stripe]).get('stripe')).toBe(stripe);
  });

  it('throws an unsupported ProviderError for an unregistered provider', () => {
    const registry = createAdapterRegistry([stripe]);
    expect(() => registry.get('paddle')).toThrow(ProviderError);
    expect(() => registry.get('nope')).toThrow(/nope/);
  });

  it('rejects duplicate registrations', () => {
    expect(() => createAdapterRegistry([stripe, stripe])).toThrow(/duplicate/i);
  });
});
