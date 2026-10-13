import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { safeErrorMessage } from '../logger';

export class PermanentJobError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof PermanentJobError) return false;
  if (err instanceof ProviderError) return err.retryable;
  return true;
}

const MAX_ERROR_LENGTH = 1000;

export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${safeErrorMessage(err)}` : String(err);
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}
