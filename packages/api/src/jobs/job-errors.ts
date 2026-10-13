import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { safeErrorMessage } from '../safe-error-message';
import { PermanentJobError } from './permanent-job-error';

export function isRetryable(err: unknown): boolean {
  if (err instanceof PermanentJobError) return false;
  if (err instanceof ProviderError) return err.retryable;
  return true;
}

const MAX_ERROR_LENGTH = 1000;

export function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const message = safeErrorMessage(err);
  const code: unknown = Reflect.get(err, 'code');
  const raw = [err.name, typeof code === 'string' ? code : undefined, message]
    .filter(Boolean)
    .join(': ');
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}
