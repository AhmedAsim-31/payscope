import { paddleAdapter } from '@payscope/provider-adapters/paddle/paddle-adapter';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { createAdapterRegistry, type AdapterRegistry } from '@payscope/provider-adapters/registry';
import { stripeAdapter } from '@payscope/provider-adapters/stripe/stripe-adapter';

export function createDefaultAdapterRegistry(): AdapterRegistry {
  return createAdapterRegistry([stripeAdapter, paddleAdapter]);
}

export function findAdapter(
  registry: AdapterRegistry,
  provider: string,
): ProviderAdapter | undefined {
  try {
    return registry.get(provider);
  } catch {
    return undefined;
  }
}
