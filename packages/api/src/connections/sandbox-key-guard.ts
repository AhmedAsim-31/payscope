import type { ProviderName } from '@payscope/provider-adapters/provider-name';
import { ApiHttpError } from '../http-error';

const SANDBOX_RULES: Partial<Record<ProviderName, (key: string) => boolean>> = {
  stripe: (key) => !key.startsWith('sk_live_') && !key.startsWith('rk_live_'),
  paddle: (key) => key.startsWith('pdl_sdbx_'),
};

export function assertSandboxApiKey(provider: ProviderName, apiKey: string | undefined): void {
  if (apiKey === undefined) return;
  if (SANDBOX_RULES[provider]?.(apiKey) === false) {
    throw new ApiHttpError(422, 'LIVE_KEYS_NOT_ALLOWED', 'Only sandbox API keys are accepted');
  }
}
