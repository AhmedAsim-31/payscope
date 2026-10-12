import type { ProviderAdapter } from './adapter';
import { ProviderError } from './provider-error';

export type AdapterRegistry = {
  get(provider: string): ProviderAdapter;
};

export function createAdapterRegistry(adapters: readonly ProviderAdapter[]): AdapterRegistry {
  const byProvider = new Map<string, ProviderAdapter>();
  for (const adapter of adapters) {
    if (byProvider.has(adapter.provider)) {
      throw new Error(`Duplicate adapter registered for ${adapter.provider}`);
    }
    byProvider.set(adapter.provider, adapter);
  }
  return {
    get(provider) {
      const adapter = byProvider.get(provider);
      if (!adapter) {
        throw new ProviderError(
          'unsupported_event',
          `No adapter registered for provider: ${provider}`,
        );
      }
      return adapter;
    },
  };
}
