export const PROVIDER_ERROR_CATEGORIES = [
  'transient',
  'permanent',
  'invalid_input',
  'provider_auth',
  'unsupported_event',
  'state_conflict',
  'not_found',
  'unavailable',
] as const;

export type ProviderErrorCategory = (typeof PROVIDER_ERROR_CATEGORIES)[number];

const RETRYABLE: readonly ProviderErrorCategory[] = ['transient', 'unavailable'];

export function classifyHttpStatus(status: number): ProviderErrorCategory {
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 404) return 'not_found';
  if (status === 409) return 'state_conflict';
  return 'invalid_input';
}

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly status: number | undefined;
  readonly reason: string | undefined;

  constructor(
    category: ProviderErrorCategory,
    message: string,
    options: { status?: number; cause?: unknown; reason?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.category = category;
    this.status = options.status;
    this.reason = options.reason;
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.category);
  }

  static fromHttpStatus(status: number, message: string, cause?: unknown): ProviderError {
    return new ProviderError(classifyHttpStatus(status), message, { status, cause });
  }
}
