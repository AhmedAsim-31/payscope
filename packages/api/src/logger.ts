import { DrizzleQueryError } from 'drizzle-orm/errors';
import { pino } from 'pino';

export const LOG_REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["stripe-signature"]',
    'req.headers["paddle-signature"]',
    'req.headers["paypal-transmission-sig"]',
    'req.headers["x-revenuecat-webhook-signature"]',
  ],
  censor: '[REDACTED]',
};

// Allow-list: Postgres `detail`, `where`, `hint`, `query`, and `parameters` can all echo row values.
const SAFE_ERROR_FIELDS = [
  'code',
  'severity',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'status',
  'statusCode',
  'category',
  'reason',
] as const;
const MAX_CAUSE_DEPTH = 3;

function sqlState(err: Error): string | undefined {
  return 'code' in err && typeof err.code === 'string' && err.code.length === 5
    ? err.code
    : undefined;
}

/** Drops bound parameters and Postgres data-exception (class 22) messages, which quote input values. */
export function safeErrorMessage(err: Error, depth = 0): string {
  if (err instanceof DrizzleQueryError) {
    return err.cause instanceof Error && depth < MAX_CAUSE_DEPTH
      ? `Failed query: ${safeErrorMessage(err.cause, depth + 1)}`
      : 'Failed query';
  }
  const code = sqlState(err);
  if (code?.startsWith('22')) return `Postgres data exception ${code}`;
  return err.message;
}

type SerializedError = { type: string; message: string; stack: string; [key: string]: unknown };

function serializeError(err: unknown, depth = 0): SerializedError {
  if (!(err instanceof Error)) return { type: typeof err, message: String(err), stack: '' };
  const out: SerializedError = {
    type: err.name,
    message: safeErrorMessage(err),
    stack: (err.stack ?? '')
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .join('\n'),
  };
  for (const field of SAFE_ERROR_FIELDS) {
    const value: unknown = Reflect.get(err, field);
    if (typeof value === 'string' || typeof value === 'number') out[field] = value;
  }
  if (err.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out['cause'] = serializeError(err.cause, depth + 1);
  }
  return out;
}

export const LOG_SERIALIZERS = { err: (err: unknown) => serializeError(err) };

export function createLogger(level: string) {
  return pino({ level, redact: LOG_REDACT, serializers: LOG_SERIALIZERS });
}
