import { DrizzleQueryError } from 'drizzle-orm/errors';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { AuthError } from './auth/token-verifier';
import { ApiHttpError } from './http-error';
import { PermanentJobError } from './jobs/permanent-job-error';

const MAX_CAUSE_DEPTH = 3;
const SAFE_ERROR_TYPES = [ProviderError, PermanentJobError, ApiHttpError, AuthError];
// Integrity, rollback, and connection messages name only constraints and relations, never row values.
const SAFE_SQLSTATE_PREFIXES = ['23', '40', '08', '53300', '57014'];

/** Returns the message only for errors whose text we control or that cannot quote input; undefined otherwise. */
export function safeErrorMessage(err: Error, depth = 0): string | undefined {
  if (err instanceof DrizzleQueryError) {
    const cause =
      err.cause instanceof Error && depth < MAX_CAUSE_DEPTH
        ? safeErrorMessage(err.cause, depth + 1)
        : undefined;
    return cause ? `Failed query: ${cause}` : 'Failed query';
  }
  if (SAFE_ERROR_TYPES.some((type) => err instanceof type)) return err.message;
  const code: unknown = Reflect.get(err, 'code');
  if (typeof code === 'string' && SAFE_SQLSTATE_PREFIXES.some((p) => code.startsWith(p))) {
    return err.message;
  }
  return undefined;
}
